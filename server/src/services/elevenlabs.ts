import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { redisClient } from '../index';

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const CHUNK_DURATION = 10; // seconds

export const SUPPORTED_LANGUAGES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  hi: 'Hindi',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  ru: 'Russian',
  tr: 'Turkish',
  nl: 'Dutch',
  sv: 'Swedish',
  id: 'Indonesian',
  fil: 'Filipino',
  vi: 'Vietnamese',
  th: 'Thai',
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

interface ChunkResult {
  chunkIndex: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  dubbingId?: string;
  audioUrl?: string;
  error?: string;
}

interface SessionState {
  id: string;
  youtubeUrl: string;
  targetLang: string;
  chunks: Map<number, ChunkResult>;
  processingChunks: Set<number>;
}

// In-memory session store (use Redis in production for persistence)
const sessions = new Map<string, SessionState>();

// Create a new translation session
export const createSession = (youtubeUrl: string, targetLang: string): string => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const session: SessionState = {
    id: sessionId,
    youtubeUrl,
    targetLang,
    chunks: new Map(),
    processingChunks: new Set(),
  };

  sessions.set(sessionId, session);
  return sessionId;
};

// Request chunks for current timestamp - processes current and next chunk in parallel
export const requestChunksForTimestamp = async (
  sessionId: string,
  currentTime: number
): Promise<{ current: ChunkResult; next: ChunkResult | null }> => {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const currentChunkIndex = Math.floor(currentTime / CHUNK_DURATION);
  const nextChunkIndex = currentChunkIndex + 1;

  // Process current and next chunk in parallel
  const [currentChunk, nextChunk] = await Promise.all([
    processChunk(session, currentChunkIndex),
    processChunk(session, nextChunkIndex),
  ]);

  return {
    current: currentChunk,
    next: nextChunk,
  };
};

// Process a single chunk
const processChunk = async (session: SessionState, chunkIndex: number): Promise<ChunkResult> => {
  const startTime = chunkIndex * CHUNK_DURATION;
  const endTime = startTime + CHUNK_DURATION;

  // Check if chunk already exists
  const existingChunk = session.chunks.get(chunkIndex);
  if (existingChunk && (existingChunk.status === 'completed' || existingChunk.status === 'processing')) {
    return existingChunk;
  }

  // Check cache
  const cacheKey = `chunk:${session.youtubeUrl}:${session.targetLang}:${chunkIndex}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const cachedChunk = JSON.parse(cached) as ChunkResult;
    session.chunks.set(chunkIndex, cachedChunk);
    return cachedChunk;
  }

  // Check if already processing
  if (session.processingChunks.has(chunkIndex)) {
    return {
      chunkIndex,
      startTime,
      endTime,
      status: 'processing',
    };
  }

  // Start processing
  session.processingChunks.add(chunkIndex);

  const chunk: ChunkResult = {
    chunkIndex,
    startTime,
    endTime,
    status: 'processing',
  };
  session.chunks.set(chunkIndex, chunk);

  // Process asynchronously
  processChunkAsync(session, chunk, cacheKey).catch(console.error);

  return chunk;
};

// Async chunk processing
const processChunkAsync = async (
  session: SessionState,
  chunk: ChunkResult,
  cacheKey: string
): Promise<void> => {
  try {
    console.log(`[ELEVENLABS] Starting dubbing for chunk ${chunk.chunkIndex} (${chunk.startTime}s - ${chunk.endTime}s)`);
    // Call ElevenLabs dubbing API with time range
    const response = await client.dubbing.create({
      sourceUrl: session.youtubeUrl,
      sourceLang: 'auto',
      targetLang: session.targetLang,
      numSpeakers: 0,
      watermark: false,
      highestResolution: false,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
    });

    chunk.dubbingId = response.dubbingId;
    console.log(`[ELEVENLABS] Dubbing ID ${response.dubbingId} created for chunk ${chunk.chunkIndex}`);

    // Poll for completion
    await pollForChunkCompletion(chunk, session.targetLang);

    chunk.status = 'completed';
    chunk.audioUrl = `/api/stream/audio/${chunk.dubbingId}/${session.targetLang}`;
    console.log(`[ELEVENLABS] Chunk ${chunk.chunkIndex} completed! Audio URL: ${chunk.audioUrl}`);

    // Cache the result
    await redisClient.set(cacheKey, JSON.stringify(chunk), { EX: 86400 }); // 24 hour cache

  } catch (error) {
    console.error(`[ELEVENLABS] Chunk ${chunk.chunkIndex} failed:`, error);
    chunk.status = 'failed';
    chunk.error = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    session.processingChunks.delete(chunk.chunkIndex);
    session.chunks.set(chunk.chunkIndex, chunk);
  }
};

// Poll for chunk completion
const pollForChunkCompletion = async (chunk: ChunkResult, targetLang: string): Promise<void> => {
  const maxAttempts = 60; // 5 minutes max for a 30s chunk

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!chunk.dubbingId) throw new Error('No dubbing ID');

    const status = await client.dubbing.get(chunk.dubbingId);

    if (status.status === 'dubbed') {
      return;
    }

    if (status.status === 'failed') {
      throw new Error(`Dubbing failed: ${status.error || 'Unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Dubbing timed out');
};

// Get chunk status
export const getChunkStatus = (sessionId: string, chunkIndex: number): ChunkResult | null => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  return session.chunks.get(chunkIndex) || null;
};

// Get all chunks status for a session
export const getSessionStatus = (sessionId: string): { chunks: ChunkResult[] } | null => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  return {
    chunks: Array.from(session.chunks.values()).sort((a, b) => a.chunkIndex - b.chunkIndex),
  };
};

// Stream dubbed audio
export const getDubbedAudioStream = async (dubbingId: string, targetLang: string) => {
  return client.dubbing.audio.get(dubbingId, targetLang);
};

// Cleanup session
export const deleteSession = (sessionId: string): void => {
  sessions.delete(sessionId);
};

export { CHUNK_DURATION };
