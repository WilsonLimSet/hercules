import { Router, Request, Response } from 'express';
import { fetchTranscript, TranscriptSegment } from '../services/transcript';
import { translateText } from '../services/translate';
import { generateSpeech, VOICES } from '../services/tts';
import { redisClient } from '../index';

export const ttsRouter = Router();

// Translated segment with audio
interface TranslatedSegment {
  index: number;
  originalText: string;
  translatedText: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  audioBuffer?: Buffer;
  audioReady: boolean;
}

// Session with full transcript
interface TTSSession {
  id: string;
  youtubeUrl: string;
  targetLang: string;
  segments: TranslatedSegment[];
  generatingAudio: Set<number>;
}

const sessions = new Map<string, TTSSession>();

// Merge small transcript segments into larger sentence-based chunks
const mergeIntoSentences = (rawSegments: TranscriptSegment[], targetDuration = 6): TranslatedSegment[] => {
  const merged: TranslatedSegment[] = [];
  let currentText = '';
  let startTime = 0;
  let endTime = 0;
  let segmentIndex = 0;

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const segStartTime = seg.offset / 1000;
    const segEndTime = (seg.offset + seg.duration) / 1000;

    if (currentText === '') {
      startTime = segStartTime;
    }

    currentText += (currentText ? ' ' : '') + seg.text;
    endTime = segEndTime;

    // Check if we should create a new merged segment
    const duration = endTime - startTime;
    const endsWithPunctuation = /[.!?]$/.test(seg.text.trim());
    const isLastSegment = i === rawSegments.length - 1;

    // Create segment if: duration >= target OR ends with sentence punctuation OR is last
    if (duration >= targetDuration || endsWithPunctuation || isLastSegment) {
      merged.push({
        index: segmentIndex++,
        originalText: currentText.trim(),
        translatedText: '',
        startTime,
        endTime,
        audioReady: false,
      });
      currentText = '';
    }
  }

  return merged;
};

// Create session - fetches and translates entire transcript upfront
ttsRouter.post('/session', async (req: Request, res: Response) => {
  try {
    const { youtubeUrl, targetLang } = req.body;
    console.log(`[TTS-SESSION] Creating for ${youtubeUrl} -> ${targetLang}`);

    if (!youtubeUrl || !targetLang) {
      res.status(400).json({ error: 'Missing youtubeUrl or targetLang' });
      return;
    }

    // Fetch transcript
    let rawTranscript: TranscriptSegment[];
    try {
      rawTranscript = await fetchTranscript(youtubeUrl);
      console.log(`[TTS-SESSION] Got ${rawTranscript.length} raw transcript segments`);
    } catch (error) {
      console.error('[TTS-SESSION] Failed to fetch transcript:', error);
      res.status(400).json({ error: 'Failed to fetch transcript. Video may not have captions.' });
      return;
    }

    const sessionId = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Merge small segments into larger sentence-based chunks (~12 seconds each)
    const segments = mergeIntoSentences(rawTranscript, 12);
    console.log(`[TTS-SESSION] Merged into ${segments.length} sentence segments`);

    const session: TTSSession = {
      id: sessionId,
      youtubeUrl,
      targetLang,
      segments,
      generatingAudio: new Set(),
    };

    sessions.set(sessionId, session);

    // Start translating all segments in background, then pre-generate first few audio
    translateAllSegments(session).then(() => {
      // Pre-generate audio for first 3 segments
      for (let i = 0; i < Math.min(3, session.segments.length); i++) {
        const seg = session.segments[i];
        if (seg.translatedText && !seg.audioReady && !session.generatingAudio.has(i)) {
          session.generatingAudio.add(i);
          generateSegmentAudio(session, seg).catch(console.error);
        }
      }
    }).catch(console.error);

    res.json({
      sessionId,
      totalSegments: segments.length,
      duration: segments.length > 0 ? segments[segments.length - 1].endTime : 0,
    });
  } catch (error) {
    console.error('[TTS-SESSION] Error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Translate all segments in background
async function translateAllSegments(session: TTSSession) {
  console.log(`[TTS] Translating ${session.segments.length} segments to ${session.targetLang}`);

  // Batch translate for efficiency (combine text with separator)
  const batchSize = 10;
  for (let i = 0; i < session.segments.length; i += batchSize) {
    const batch = session.segments.slice(i, i + batchSize);
    const combinedText = batch.map(s => s.originalText).join(' ||| ');

    try {
      const result = await translateText(combinedText, 'auto', session.targetLang);
      const translations = result.translated.split(' ||| ');

      batch.forEach((seg, idx) => {
        seg.translatedText = translations[idx] || seg.originalText;
      });

      console.log(`[TTS] Translated segments ${i} to ${i + batch.length - 1}`);
    } catch (error) {
      console.error(`[TTS] Failed to translate batch ${i}:`, error);
      // Fallback: keep original text
      batch.forEach(seg => {
        seg.translatedText = seg.originalText;
      });
    }
  }

  console.log(`[TTS] All segments translated`);
}

// Get segment for current time and generate audio if needed
ttsRouter.post('/session/:sessionId/segment', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { currentTime, segmentIndex } = req.body;

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Find segment - either by index (for preloading) or by currentTime
    let segment: TranslatedSegment | undefined;
    if (typeof segmentIndex === 'number') {
      segment = session.segments[segmentIndex];
    } else {
      segment = session.segments.find(
        s => currentTime >= s.startTime && currentTime < s.endTime
      );
    }

    if (!segment) {
      // No segment at this time (silence in video)
      res.json({ segment: null, status: 'no_segment' });
      return;
    }

    // Check if audio is ready
    if (segment.audioReady && segment.audioBuffer) {
      res.json({
        segment: {
          index: segment.index,
          text: segment.translatedText,
          startTime: segment.startTime,
          endTime: segment.endTime,
        },
        status: 'ready',
        audioUrl: `/api/tts/session/${sessionId}/audio/${segment.index}`,
      });
      return;
    }

    // Check if translation is ready
    if (!segment.translatedText) {
      res.json({
        segment: { index: segment.index, startTime: segment.startTime, endTime: segment.endTime },
        status: 'translating',
      });
      return;
    }

    // Check if already generating audio
    if (session.generatingAudio.has(segment.index)) {
      res.json({
        segment: { index: segment.index, startTime: segment.startTime, endTime: segment.endTime },
        status: 'generating_audio',
      });
      return;
    }

    // Start generating audio
    session.generatingAudio.add(segment.index);
    res.json({
      segment: { index: segment.index, startTime: segment.startTime, endTime: segment.endTime },
      status: 'generating_audio',
    });

    // Generate audio in background
    generateSegmentAudio(session, segment).catch(console.error);
  } catch (error) {
    console.error('[TTS-SEGMENT] Error:', error);
    res.status(500).json({ error: 'Failed to get segment' });
  }
});

// Generate audio for a segment
async function generateSegmentAudio(session: TTSSession, segment: TranslatedSegment) {
  try {
    // Check cache first
    const cacheKey = `tts-audio:${session.youtubeUrl}:${session.targetLang}:${segment.index}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      segment.audioBuffer = Buffer.from(cached, 'base64');
      segment.audioReady = true;
      session.generatingAudio.delete(segment.index);
      console.log(`[TTS] Loaded cached audio for segment ${segment.index}`);
      return;
    }

    console.log(`[TTS] Generating audio for segment ${segment.index}: "${segment.translatedText.substring(0, 30)}..."`);

    const audioBuffer = await generateSpeech(segment.translatedText, {
      voiceId: VOICES.adam,
    });

    segment.audioBuffer = audioBuffer;
    segment.audioReady = true;
    session.generatingAudio.delete(segment.index);

    // Cache for 24 hours
    await redisClient.set(cacheKey, audioBuffer.toString('base64'), { EX: 86400 });

    console.log(`[TTS] Audio ready for segment ${segment.index}`);

    // Pre-generate next few segments
    for (let i = 1; i <= 3; i++) {
      const nextSeg = session.segments[segment.index + i];
      if (nextSeg && nextSeg.translatedText && !nextSeg.audioReady && !session.generatingAudio.has(nextSeg.index)) {
        session.generatingAudio.add(nextSeg.index);
        generateSegmentAudio(session, nextSeg).catch(console.error);
      }
    }
  } catch (error) {
    console.error(`[TTS] Failed to generate audio for segment ${segment.index}:`, error);
    session.generatingAudio.delete(segment.index);
  }
}

// Stream audio for a segment
ttsRouter.get('/session/:sessionId/audio/:segmentIndex', (req: Request, res: Response) => {
  const { sessionId, segmentIndex } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const segment = session.segments[parseInt(segmentIndex)];
  if (!segment || !segment.audioBuffer) {
    res.status(404).json({ error: 'Audio not ready' });
    return;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', segment.audioBuffer.length);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(segment.audioBuffer);
});

// Get session status
ttsRouter.get('/session/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const translatedCount = session.segments.filter(s => s.translatedText).length;
  const audioReadyCount = session.segments.filter(s => s.audioReady).length;

  // Include transcript for Q&A feature (combine all original text)
  const transcript = session.segments.map(s => s.originalText).join(' ');

  res.json({
    sessionId,
    totalSegments: session.segments.length,
    translatedSegments: translatedCount,
    audioReadySegments: audioReadyCount,
    transcript,
  });
});

// Delete session
ttsRouter.delete('/session/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  sessions.delete(sessionId);
  res.json({ success: true });
});

// Get available voices
ttsRouter.get('/voices', (_req: Request, res: Response) => {
  res.json(VOICES);
});
