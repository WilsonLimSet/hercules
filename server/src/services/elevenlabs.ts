import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { redisClient } from '../index';

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Chunk duration in seconds
const CHUNK_DURATION = 30;

// Supported languages for dubbing
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

interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  dubbingId?: string;
  audioUrl?: string;
  error?: string;
}

interface DubbingJob {
  id: string;
  youtubeUrl: string;
  sourceLang: string;
  targetLang: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunks: ChunkInfo[];
  currentChunk: number;
  totalChunks: number;
  videoDuration?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// Create a dubbing job for a YouTube video with chunking
export const createDubbingJob = async (
  youtubeUrl: string,
  sourceLang: string,
  targetLang: string,
  videoDuration?: number
): Promise<DubbingJob> => {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Calculate chunks based on video duration
  // If duration unknown, start with first chunk and expand as needed
  const duration = videoDuration || CHUNK_DURATION; // Default to one chunk if unknown
  const totalChunks = Math.ceil(duration / CHUNK_DURATION);

  const chunks: ChunkInfo[] = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push({
      index: i,
      startTime: i * CHUNK_DURATION,
      endTime: Math.min((i + 1) * CHUNK_DURATION, duration),
      status: 'pending',
    });
  }

  const job: DubbingJob = {
    id: jobId,
    youtubeUrl,
    sourceLang,
    targetLang,
    status: 'pending',
    chunks,
    currentChunk: 0,
    totalChunks,
    videoDuration: duration,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Store job in Redis
  await redisClient.set(`job:${jobId}`, JSON.stringify(job));

  // Start processing first chunk immediately
  processNextChunk(job).catch(console.error);

  return job;
};

// Process the next pending chunk
const processNextChunk = async (job: DubbingJob): Promise<void> => {
  const pendingChunk = job.chunks.find(c => c.status === 'pending');

  if (!pendingChunk) {
    // All chunks done, mark job as completed
    job.status = 'completed';
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    // Cache the completed job
    const cacheKey = `dub:${job.youtubeUrl}:${job.targetLang}`;
    await redisClient.set(cacheKey, JSON.stringify(job), { EX: 86400 * 7 });
    return;
  }

  try {
    // Update chunk status to processing
    pendingChunk.status = 'processing';
    job.status = 'processing';
    job.currentChunk = pendingChunk.index;
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    // Call ElevenLabs dubbing API with time range
    const response = await client.dubbing.dubAVideoOrAnAudioFile({
      sourceUrl: job.youtubeUrl,
      sourceLang: job.sourceLang,
      targetLang: job.targetLang,
      numSpeakers: 0,
      watermark: false,
      highestResolution: false,
      startTime: pendingChunk.startTime,
      endTime: pendingChunk.endTime,
    });

    pendingChunk.dubbingId = response.dubbingId;
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    // Poll for completion
    await pollChunkCompletion(job, pendingChunk);

    // Process next chunk
    await processNextChunk(job);

  } catch (error) {
    pendingChunk.status = 'failed';
    pendingChunk.error = error instanceof Error ? error.message : 'Unknown error';
    job.status = 'failed';
    job.error = pendingChunk.error;
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));
    throw error;
  }
};

// Poll ElevenLabs API for chunk completion
const pollChunkCompletion = async (job: DubbingJob, chunk: ChunkInfo): Promise<void> => {
  const maxAttempts = 60; // 5 minutes max for a 30s chunk

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!chunk.dubbingId) throw new Error('No dubbing ID for chunk');

    const status = await client.dubbing.getDubbingProjectMetadata(chunk.dubbingId);

    if (status.status === 'dubbed') {
      chunk.status = 'completed';
      chunk.audioUrl = `/api/dubbing/audio/${chunk.dubbingId}/${job.targetLang}`;
      job.updatedAt = Date.now();
      await redisClient.set(`job:${job.id}`, JSON.stringify(job));
      return;
    }

    if (status.status === 'failed') {
      throw new Error(`Chunk dubbing failed: ${status.error || 'Unknown error'}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Chunk dubbing timed out');
};

// Request a specific chunk to be processed (for on-demand loading)
export const requestChunk = async (jobId: string, chunkIndex: number): Promise<ChunkInfo | null> => {
  const jobData = await redisClient.get(`job:${jobId}`);
  if (!jobData) return null;

  const job: DubbingJob = JSON.parse(jobData);

  if (chunkIndex >= job.chunks.length) return null;

  const chunk = job.chunks[chunkIndex];

  // If chunk is already completed or processing, return it
  if (chunk.status === 'completed' || chunk.status === 'processing') {
    return chunk;
  }

  // If chunk is pending and we're not already processing it, start processing
  if (chunk.status === 'pending') {
    // Mark all earlier chunks as pending priority
    processChunkPriority(job, chunkIndex).catch(console.error);
  }

  return chunk;
};

// Process a specific chunk with priority
const processChunkPriority = async (job: DubbingJob, targetIndex: number): Promise<void> => {
  const chunk = job.chunks[targetIndex];
  if (chunk.status !== 'pending') return;

  try {
    chunk.status = 'processing';
    job.currentChunk = targetIndex;
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    const response = await client.dubbing.dubAVideoOrAnAudioFile({
      sourceUrl: job.youtubeUrl,
      sourceLang: job.sourceLang,
      targetLang: job.targetLang,
      numSpeakers: 0,
      watermark: false,
      highestResolution: false,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
    });

    chunk.dubbingId = response.dubbingId;
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    await pollChunkCompletion(job, chunk);

  } catch (error) {
    chunk.status = 'failed';
    chunk.error = error instanceof Error ? error.message : 'Unknown error';
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));
  }
};

// Get job status
export const getJobStatus = async (jobId: string): Promise<DubbingJob | null> => {
  const job = await redisClient.get(`job:${jobId}`);
  return job ? JSON.parse(job) : null;
};

// Get chunk status for a specific time
export const getChunkForTime = async (jobId: string, currentTime: number): Promise<ChunkInfo | null> => {
  const jobData = await redisClient.get(`job:${jobId}`);
  if (!jobData) return null;

  const job: DubbingJob = JSON.parse(jobData);
  const chunkIndex = Math.floor(currentTime / CHUNK_DURATION);

  if (chunkIndex >= job.chunks.length) return null;

  return job.chunks[chunkIndex];
};

// Get dubbed audio stream
export const getDubbedAudio = async (dubbingId: string, targetLang: string) => {
  return client.dubbing.getDubbedFile(dubbingId, targetLang);
};

export { CHUNK_DURATION };
export type { DubbingJob, ChunkInfo };
