import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { redisClient } from '../index';

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

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

interface DubbingJob {
  id: string;
  youtubeUrl: string;
  sourceLang: string;
  targetLang: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  dubbingId?: string;
  audioUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// Create a dubbing job for a YouTube video
export async function createDubbingJob(
  youtubeUrl: string,
  sourceLang: string,
  targetLang: string
): Promise<DubbingJob> {
  // Check cache first
  const cacheKey = `dub:${youtubeUrl}:${targetLang}`;
  const cached = await redisClient.get(cacheKey);

  if (cached) {
    const cachedJob = JSON.parse(cached) as DubbingJob;
    if (cachedJob.status === 'completed' && cachedJob.audioUrl) {
      return cachedJob;
    }
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const job: DubbingJob = {
    id: jobId,
    youtubeUrl,
    sourceLang,
    targetLang,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Store job in Redis
  await redisClient.set(`job:${jobId}`, JSON.stringify(job));

  // Start dubbing process asynchronously
  processDubbingJob(job).catch(console.error);

  return job;
}

// Process the dubbing job
async function processDubbingJob(job: DubbingJob): Promise<void> {
  try {
    // Update status to processing
    job.status = 'processing';
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    // Call ElevenLabs dubbing API
    const response = await client.dubbing.dubAVideoOrAnAudioFile({
      sourceUrl: job.youtubeUrl,
      sourceLang: job.sourceLang,
      targetLang: job.targetLang,
      numSpeakers: 0, // Auto-detect
      watermark: false,
      highestResolution: false, // We only need audio
    });

    job.dubbingId = response.dubbingId;
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

    // Poll for completion
    const dubbedAudioUrl = await pollForCompletion(response.dubbingId, job.targetLang);

    job.status = 'completed';
    job.audioUrl = dubbedAudioUrl;
    job.updatedAt = Date.now();

    // Cache the completed job
    const cacheKey = `dub:${job.youtubeUrl}:${job.targetLang}`;
    await redisClient.set(cacheKey, JSON.stringify(job), { EX: 86400 * 7 }); // Cache for 7 days
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));

  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.updatedAt = Date.now();
    await redisClient.set(`job:${job.id}`, JSON.stringify(job));
    throw error;
  }
}

// Poll ElevenLabs API for dubbing completion
async function pollForCompletion(dubbingId: string, targetLang: string): Promise<string> {
  const maxAttempts = 120; // 10 minutes max (5 second intervals)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await client.dubbing.getDubbingProjectMetadata(dubbingId);

    if (status.status === 'dubbed') {
      // Get the dubbed audio file
      const audioStream = await client.dubbing.getDubbedFile(dubbingId, targetLang);

      // For now, we'll need to store/serve this audio
      // In production, you'd upload to S3/GCS and return the URL
      // For MVP, we'll return a local endpoint
      return `/api/dubbing/audio/${dubbingId}/${targetLang}`;
    }

    if (status.status === 'failed') {
      throw new Error(`Dubbing failed: ${status.error || 'Unknown error'}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Dubbing timed out');
}

// Get job status
export async function getJobStatus(jobId: string): Promise<DubbingJob | null> {
  const job = await redisClient.get(`job:${jobId}`);
  return job ? JSON.parse(job) : null;
}

// Get dubbed audio stream
export async function getDubbedAudio(dubbingId: string, targetLang: string) {
  return client.dubbing.getDubbedFile(dubbingId, targetLang);
}
