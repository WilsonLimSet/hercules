import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { processConversation, generateResponse } from '../services/conversational-ai';
import { generateSpeech } from '../services/tts';

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
 * Optional: include videoContext (transcript) as form field
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

    // Parse video context from form field (if provided)
    let videoContext: { transcript?: string; title?: string } | undefined;
    if (req.body.videoContext) {
      try {
        videoContext = JSON.parse(req.body.videoContext);
        console.log(`[CONVERSATION] Video context provided: ${videoContext?.transcript?.length || 0} chars`);
      } catch {
        console.log('[CONVERSATION] Failed to parse videoContext, continuing without it');
      }
    }

    // Process the conversation with video context
    const result = await processConversation(tempFilePath, videoContext);

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
 * POST /api/conversation/ask-text
 * Text-based question (no audio upload needed)
 */
conversationRouter.post('/ask-text', async (req: Request, res: Response) => {
  try {
    const { question, videoContext } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    console.log(`[CONVERSATION] Text question: "${question}"`);
    if (videoContext?.transcript) {
      console.log(`[CONVERSATION] Video context: ${videoContext.transcript.length} chars`);
    }

    // Generate response using GPT
    const responseText = await generateResponse(question, 'en', videoContext);

    // Generate TTS audio for the response
    let audioBase64: string | undefined;
    try {
      const audioBuffer = await generateSpeech(responseText, {
        modelId: 'eleven_multilingual_v2',
      });
      audioBase64 = audioBuffer.toString('base64');
    } catch (ttsError) {
      console.error('[CONVERSATION] TTS failed, returning text only:', ttsError);
    }

    res.json({
      success: true,
      responseText,
      audioBase64,
    });
  } catch (error) {
    console.error('[CONVERSATION] Text error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process question',
    });
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

