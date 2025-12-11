import { Router, Request, Response } from 'express';
import {
  createSession,
  requestChunksForTimestamp,
  getChunkStatus,
  getSessionStatus,
  getDubbedAudioStream,
  deleteSession,
  SUPPORTED_LANGUAGES,
  CHUNK_DURATION,
} from '../services/elevenlabs';
import { Readable } from 'stream';

export const dubbingRouter = Router();

// Get supported languages
dubbingRouter.get('/languages', (_req: Request, res: Response) => {
  res.json(SUPPORTED_LANGUAGES);
});

// Get config
dubbingRouter.get('/config', (_req: Request, res: Response) => {
  res.json({ chunkDuration: CHUNK_DURATION });
});

// Create a new translation session
dubbingRouter.post('/session', (req: Request, res: Response) => {
  try {
    const { youtubeUrl, targetLang } = req.body;
    console.log(`[SESSION] Creating session for ${youtubeUrl} -> ${targetLang}`);

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

    const sessionId = createSession(youtubeUrl, targetLang);
    res.json({ sessionId, chunkDuration: CHUNK_DURATION });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Request chunks for current timestamp (current + next in parallel)
dubbingRouter.post('/session/:sessionId/chunks', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { currentTime } = req.body;
    console.log(`[CHUNKS] Session ${sessionId} requesting chunks at time ${currentTime}`);

    if (currentTime === undefined) {
      res.status(400).json({ error: 'Missing currentTime' });
      return;
    }

    const chunks = await requestChunksForTimestamp(sessionId, Number(currentTime));
    console.log(`[CHUNKS] Returning chunks:`, JSON.stringify(chunks, null, 2));
    res.json(chunks);
  } catch (error) {
    console.error('Error requesting chunks:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to request chunks' });
  }
});

// Get status of a specific chunk
dubbingRouter.get('/session/:sessionId/chunk/:chunkIndex', (req: Request, res: Response) => {
  try {
    const { sessionId, chunkIndex } = req.params;
    const chunk = getChunkStatus(sessionId, Number(chunkIndex));

    if (!chunk) {
      res.status(404).json({ error: 'Chunk not found' });
      return;
    }

    res.json(chunk);
  } catch (error) {
    console.error('Error getting chunk status:', error);
    res.status(500).json({ error: 'Failed to get chunk status' });
  }
});

// Get session status (all chunks)
dubbingRouter.get('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const status = getSessionStatus(sessionId);

    if (!status) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(status);
  } catch (error) {
    console.error('Error getting session status:', error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Delete session
dubbingRouter.delete('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    deleteSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Stream dubbed audio
dubbingRouter.get('/stream/audio/:dubbingId/:targetLang', async (req: Request, res: Response) => {
  try {
    const { dubbingId, targetLang } = req.params;

    const audioStream = await getDubbedAudioStream(dubbingId, targetLang);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

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
      res.send(audioStream);
    }
  } catch (error) {
    console.error('Error streaming audio:', error);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});
