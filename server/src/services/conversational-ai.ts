import OpenAI from 'openai';
import { generateSpeech } from './tts';
import fs from 'fs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ConversationResponse {
  questionText: string;
  responseText: string;
  audioBuffer: Buffer;
  detectedLanguage: string;
}

interface VideoContext {
  transcript?: string;
  title?: string;
  targetLanguage?: string;
}

/**
 * Convert speech to text using OpenAI Whisper
 */
export const speechToText = async (audioFilePath: string): Promise<{ text: string; language: string }> => {
  console.log('[CONVERSATIONAL-AI] Converting speech to text...');
  
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
      response_format: 'verbose_json', // Get language info
    });

    console.log(`[CONVERSATIONAL-AI] Transcribed: "${transcription.text}" (${transcription.language})`);
    
    return {
      text: transcription.text,
      language: transcription.language || 'en',
    };
  } catch (error) {
    console.error('[CONVERSATIONAL-AI] Speech-to-text failed:', error);
    throw new Error('Failed to convert speech to text');
  }
};

/**
 * Generate a conversational response using GPT
 */
export const generateResponse = async (
  question: string,
  language: string,
  videoContext?: VideoContext
): Promise<string> => {
  console.log(`[CONVERSATIONAL-AI] Generating response for: "${question}" in ${language}`);

  let systemPrompt: string;

  if (videoContext?.transcript) {
    // Create a context-aware prompt when we have video transcript
    const transcriptSnippet = videoContext.transcript.length > 4000
      ? videoContext.transcript.substring(0, 4000) + '...'
      : videoContext.transcript;

    systemPrompt = `You are a video content assistant. You ONLY answer questions about the video the user is watching.

VIDEO TRANSCRIPT:
${transcriptSnippet}

STRICT RULES:
- ONLY answer questions directly related to the video content above
- If the question is NOT about the video (e.g. general knowledge, unrelated topics), politely say: "I can only answer questions about this video. What would you like to know about what's being discussed?"
- Base your answers strictly on what's in the transcript
- Respond in ${language}
- Keep responses concise (2-3 sentences) but informative
- Be friendly and conversational`;
  } else {
    // No transcript - explain limitation
    systemPrompt = `You are a video assistant but no video transcript is available. Politely explain that you need the user to start video translation first before you can answer questions about the video. Respond in ${language}.`;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-effective
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: question,
        },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const response = completion.choices[0]?.message?.content || 'I apologize, I could not generate a response.';
    console.log(`[CONVERSATIONAL-AI] Generated response: "${response}"`);

    return response;
  } catch (error) {
    console.error('[CONVERSATIONAL-AI] Response generation failed:', error);
    throw new Error('Failed to generate response');
  }
};

/**
 * Full conversation pipeline: speech -> text -> response -> speech
 */
export const processConversation = async (
  audioFilePath: string,
  videoContext?: VideoContext
): Promise<ConversationResponse> => {
  console.log('[CONVERSATIONAL-AI] Starting conversation pipeline...');
  if (videoContext?.transcript) {
    console.log(`[CONVERSATIONAL-AI] Video context provided (${videoContext.transcript.length} chars)`);
  }

  // Step 1: Speech to Text
  const { text: questionText, language: detectedLanguage } = await speechToText(audioFilePath);

  // Step 2: Generate Response with video context
  const responseText = await generateResponse(questionText, detectedLanguage, videoContext);

  // Step 3: Text to Speech
  const audioBuffer = await generateSpeech(responseText, {
    modelId: 'eleven_multilingual_v2',
  });

  console.log('[CONVERSATIONAL-AI] Conversation pipeline completed!');

  return {
    questionText,
    responseText,
    audioBuffer,
    detectedLanguage,
  };
};

