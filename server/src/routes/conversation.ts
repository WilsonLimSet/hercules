import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { processConversation } from '../services/conversational-ai';

const conversationRouter = Router();

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '../../temp/'),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    const allowedMimes = [
      'audio/webm',
      'audio/wav',
      'audio/mp3',
      'audio/mpeg',
      'audio/ogg',
      'audio/m4a',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, '../../temp/');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * POST /api/conversation/ask
 * Upload audio question and get AI response
 */
conversationRouter.post('/ask', upload.single('audio'), async (req: Request, res: Response) => {
  let tempFilePath: string | undefined;
  
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    tempFilePath = req.file.path;
    console.log(`[CONVERSATION] Received audio file: ${tempFilePath}`);

    // Process the conversation
    const result = await processConversation(tempFilePath);

    // Send response as JSON with audio as base64
    res.json({
      success: true,
      questionText: result.questionText,
      responseText: result.responseText,
      detectedLanguage: result.detectedLanguage,
      audioBase64: result.audioBuffer.toString('base64'),
    });

  } catch (error) {
    console.error('[CONVERSATION] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process conversation',
    });
  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      console.log(`[CONVERSATION] Cleaned up temp file: ${tempFilePath}`);
    }
  }
});

/**
 * GET /api/conversation/status
 * Check if conversation API is ready
 */
conversationRouter.get('/status', (req: Request, res: Response) => {
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;
  
  res.json({
    ready: hasOpenAIKey && hasElevenLabsKey,
    openai: hasOpenAIKey,
    elevenlabs: hasElevenLabsKey,
  });
});

export default conversationRouter;

