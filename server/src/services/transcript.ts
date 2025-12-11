import { execSync } from 'child_process';
import path from 'path';
import { transcribeYouTubeVideo } from './stt';

export interface TranscriptSegment {
  text: string;
  offset: number; // start time in ms
  duration: number; // duration in ms
}

export interface TranscriptChunk {
  chunkIndex: number;
  startTime: number; // seconds
  endTime: number; // seconds
  segments: TranscriptSegment[];
  fullText: string;
}

// Extract video ID from YouTube URL
export const extractVideoId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

// Fetch transcript using Python script (more reliable than npm package)
// Falls back to ElevenLabs STT if YouTube captions unavailable
export const fetchTranscript = async (videoUrl: string): Promise<TranscriptSegment[]> => {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  console.log(`[TRANSCRIPT] Fetching transcript for video: ${videoId}`);

  // Try YouTube captions first
  try {
    const scriptPath = path.join(__dirname, '../../scripts/get_transcript.py');
    const output = execSync(`python3 "${scriptPath}" "${videoId}"`, {
      encoding: 'utf-8',
      timeout: 30000,
    });

    const result = JSON.parse(output);

    if (result.success && result.segments.length > 0) {
      console.log(`[TRANSCRIPT] Got ${result.segments.length} segments from YouTube captions`);
      return result.segments;
    }

    // No captions available, fall through to STT
    console.log('[TRANSCRIPT] No YouTube captions, falling back to STT');
  } catch (error) {
    console.log('[TRANSCRIPT] YouTube captions failed, falling back to STT:', error);
  }

  // Fallback: Use ElevenLabs Speech-to-Text
  try {
    console.log('[TRANSCRIPT] Using ElevenLabs STT to transcribe audio...');
    const sttResult = await transcribeYouTubeVideo(videoUrl);

    if (sttResult.segments.length === 0) {
      throw new Error('STT returned no segments');
    }

    // Convert STT segments to our format
    const segments: TranscriptSegment[] = sttResult.segments.map(seg => ({
      text: seg.text,
      offset: Math.round(seg.start * 1000), // Convert seconds to ms
      duration: Math.round((seg.end - seg.start) * 1000),
    }));

    console.log(`[TRANSCRIPT] Got ${segments.length} segments from ElevenLabs STT`);
    return segments;
  } catch (sttError) {
    console.error('[TRANSCRIPT] STT fallback also failed:', sttError);
    throw new Error('Failed to get transcript. Neither YouTube captions nor STT available.');
  }
};

// Split transcript into chunks by time
export const getTranscriptChunk = (
  segments: TranscriptSegment[],
  chunkIndex: number,
  chunkDuration: number // in seconds
): TranscriptChunk => {
  const startTime = chunkIndex * chunkDuration;
  const endTime = startTime + chunkDuration;
  const startMs = startTime * 1000;
  const endMs = endTime * 1000;

  // Filter segments that fall within this chunk
  const chunkSegments = segments.filter(seg => {
    const segEnd = seg.offset + seg.duration;
    return seg.offset < endMs && segEnd > startMs;
  });

  const fullText = chunkSegments.map(s => s.text).join(' ');

  return {
    chunkIndex,
    startTime,
    endTime,
    segments: chunkSegments,
    fullText,
  };
};
