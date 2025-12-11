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
export const generateResponse = async (question: string, language: string): Promise<string> => {
  console.log(`[CONVERSATIONAL-AI] Generating response for: "${question}" in ${language}`);
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-effective
      messages: [
        {
          role: 'system',
          content: `You are a helpful, friendly assistant. Respond naturally and conversationally in ${language}. Keep responses concise (2-3 sentences max) but informative.`,
        },
        {
          role: 'user',
          content: question,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
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
export const processConversation = async (audioFilePath: string): Promise<ConversationResponse> => {
  console.log('[CONVERSATIONAL-AI] Starting conversation pipeline...');
  
  // Step 1: Speech to Text
  const { text: questionText, language: detectedLanguage } = await speechToText(audioFilePath);
  
  // Step 2: Generate Response
  const responseText = await generateResponse(questionText, detectedLanguage);
  
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

