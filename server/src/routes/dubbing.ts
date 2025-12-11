import { Router, Request, Response } from 'express';
import {
  createDubbingJob,
  getJobStatus,
  getDubbedAudio,
  SUPPORTED_LANGUAGES,
} from '../services/elevenlabs';
import { Readable } from 'stream';

export const dubbingRouter = Router();

// Get supported languages
dubbingRouter.get('/languages', (req: Request, res: Response) => {
  res.json(SUPPORTED_LANGUAGES);
});

// Create a new dubbing job
dubbingRouter.post('/create', async (req: Request, res: Response) => {
  try {
    const { youtubeUrl, sourceLang, targetLang } = req.body;

    if (!youtubeUrl || !targetLang) {
      res.status(400).json({ error: 'Missing required fields: youtubeUrl, targetLang' });
      return;
    }

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;
    if (!youtubeRegex.test(youtubeUrl)) {
      res.status(400).json({ error: 'Invalid YouTube URL' });
      return;
    }

    const job = await createDubbingJob(youtubeUrl, sourceLang || 'auto', targetLang);
    res.json(job);
  } catch (error) {
    console.error('Error creating dubbing job:', error);
    res.status(500).json({ error: 'Failed to create dubbing job' });
  }
});

// Get job status
dubbingRouter.get('/status/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await getJobStatus(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json(job);
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Stream dubbed audio
dubbingRouter.get('/audio/:dubbingId/:targetLang', async (req: Request, res: Response) => {
  try {
    const { dubbingId, targetLang } = req.params;

    const audioStream = await getDubbedAudio(dubbingId, targetLang);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Handle the response based on its type
    if (audioStream instanceof Readable) {
      audioStream.pipe(res);
    } else if (audioStream instanceof ReadableStream) {
      const reader = audioStream.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(Buffer.from(value));
        pump();
      };
      pump();
    } else {
      // Assume it's a blob or buffer
      res.send(audioStream);
    }
  } catch (error) {
    console.error('Error streaming audio:', error);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});
