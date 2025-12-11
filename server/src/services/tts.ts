import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Readable } from 'stream';

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Available voices - you can add more from ElevenLabs
export const VOICES = {
  // Multilingual voices that work well with Indonesian
  'rachel': 'EXAVITQu4vr4xnSDxMaL', // Female, calm
  'adam': 'pNInz6obpgDQGcFmaJgB', // Male, deep
  'charlie': 'IKne3meq5aSn9XLyUdCD', // Male, casual
  'emily': 'LcfcDJNUP1GQjkzn1xUU', // Female, calm
  'dave': 'CYw3kZ02Hs0563khs1Fj', // Male, conversational
} as const;

export type VoiceId = keyof typeof VOICES;

export interface TTSOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

// Generate speech from text
export const generateSpeech = async (
  text: string,
  options: TTSOptions = {}
): Promise<Buffer> => {
  const {
    voiceId = VOICES.adam, // Default to Adam voice
    modelId = 'eleven_multilingual_v2', // Best for non-English
    stability = 0.5,
    similarityBoost = 0.75,
  } = options;

  console.log(`[TTS] Generating speech for ${text.length} chars with voice ${voiceId}`);

  try {
    const audio = await client.textToSpeech.convert(voiceId, {
      text,
      modelId,
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability,
        similarityBoost,
      },
    });

    // Convert the response to a Buffer
    if (audio instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of audio) {
        chunks.push(Buffer.from(chunk));
      }
      console.log(`[TTS] Generated ${chunks.length} chunks`);
      return Buffer.concat(chunks);
    } else if (audio instanceof ReadableStream) {
      const reader = audio.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      return Buffer.concat(chunks.map(c => Buffer.from(c)));
    } else {
      return Buffer.from(audio as ArrayBuffer);
    }
  } catch (error) {
    console.error('[TTS] Failed:', error);
    throw error;
  }
};

// Get available voices from ElevenLabs
export const getVoices = async () => {
  try {
    const response = await client.voices.getAll();
    return response.voices;
  } catch (error) {
    console.error('[TTS] Failed to get voices:', error);
    throw error;
  }
};
