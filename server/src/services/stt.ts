// ElevenLabs Speech-to-Text (Scribe) service
// Used as fallback when YouTube captions are unavailable

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

export interface STTSegment {
  text: string;
  start: number; // in seconds
  end: number; // in seconds
}

export interface STTResult {
  text: string;
  segments: STTSegment[];
}

// Download audio from YouTube using yt-dlp
export const downloadYouTubeAudio = async (videoUrl: string): Promise<string> => {
  const tempDir = os.tmpdir();
  const outputPath = path.join(tempDir, `hercules_${Date.now()}.mp3`);

  console.log(`[STT] Downloading audio from ${videoUrl}`);

  try {
    // Use yt-dlp to download audio only
    execSync(
      `yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${outputPath}" "${videoUrl}"`,
      { encoding: 'utf-8', timeout: 120000 }
    );

    console.log(`[STT] Audio downloaded to ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('[STT] Failed to download audio:', error);
    throw new Error('Failed to download audio from YouTube');
  }
};

// Transcribe audio using ElevenLabs Scribe
export const transcribeAudio = async (audioPath: string): Promise<STTResult> => {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not set');
  }

  console.log(`[STT] Transcribing ${audioPath} with ElevenLabs Scribe`);

  const fileBuffer = fs.readFileSync(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), path.basename(audioPath));
  formData.append('model_id', 'scribe_v1');
  formData.append('timestamps_granularity', 'word');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[STT] ElevenLabs API error:', error);
    throw new Error(`ElevenLabs STT failed: ${response.status}`);
  }

  interface ElevenLabsSTTResponse {
    text?: string;
    words?: Array<{ text: string; start: number; end: number }>;
  }

  const result = (await response.json()) as ElevenLabsSTTResponse;
  console.log(`[STT] Transcription complete, got ${result.words?.length || 0} words`);

  // Convert ElevenLabs response to our segment format
  // Group words into ~6 second segments (similar to our merged sentences)
  const segments: STTSegment[] = [];
  let currentSegment: STTSegment | null = null;
  const TARGET_DURATION = 6; // seconds

  for (const word of result.words || []) {
    if (!currentSegment) {
      currentSegment = {
        text: word.text,
        start: word.start,
        end: word.end,
      };
    } else {
      currentSegment.text += ' ' + word.text;
      currentSegment.end = word.end;

      // Check if we should create a new segment
      const duration = currentSegment.end - currentSegment.start;
      const endsWithPunctuation = /[.!?]$/.test(word.text.trim());

      if (duration >= TARGET_DURATION || endsWithPunctuation) {
        segments.push(currentSegment);
        currentSegment = null;
      }
    }
  }

  // Add remaining segment
  if (currentSegment) {
    segments.push(currentSegment);
  }

  return {
    text: result.text || '',
    segments,
  };
};

// Full pipeline: download audio and transcribe
export const transcribeYouTubeVideo = async (videoUrl: string): Promise<STTResult> => {
  let audioPath: string | null = null;

  try {
    audioPath = await downloadYouTubeAudio(videoUrl);
    const result = await transcribeAudio(audioPath);
    return result;
  } finally {
    // Clean up temp file
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
      console.log(`[STT] Cleaned up temp file ${audioPath}`);
    }
  }
};
