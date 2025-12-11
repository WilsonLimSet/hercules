# Conversational AI Feature Setup

## Overview

The Hercules extension now includes a conversational AI feature that allows you to:
- 🎤 Record questions in **any language**
- 🤖 Get AI-generated responses in the **same language**
- 🔊 Hear the responses spoken naturally via ElevenLabs TTS

## How It Works

1. **Speech-to-Text**: Your voice is converted to text using OpenAI Whisper API (automatically detects language)
2. **Response Generation**: OpenAI GPT-4o-mini generates a contextual response in the detected language
3. **Text-to-Speech**: ElevenLabs converts the response to natural-sounding speech
4. **Audio Playback**: The response is played back automatically

## Setup Instructions

### 1. Install Required Python Dependencies

```bash
pip3 install --user youtube-transcript-api
pip3 install --user --upgrade yt-dlp
```

### 2. Install Node.js Dependencies

```bash
cd server
npm install
```

The following packages are now installed:
- `openai` - OpenAI API client
- `multer` - File upload handling
- `@types/multer` - TypeScript types

### 3. Configure Environment Variables

Create a `.env` file in the `server` directory:

```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
REDIS_URL=redis://localhost:6379
PORT=3001
```

#### Get Your API Keys:

- **ElevenLabs API Key**: https://elevenlabs.io/app/settings/api-keys
- **OpenAI API Key**: https://platform.openai.com/api-keys

### 4. Start the Server

```bash
cd server
npm run dev
```

The server will start on `http://localhost:3001`

### 5. Build and Load the Extension

```bash
# In the root directory
pnpm install
pnpm build
```

Then load the extension in Chrome:
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` directory

## Usage

1. Open the Hercules side panel in any Chrome tab
2. Scroll to the **"🎤 Ask AI Anything"** section
3. Click **"Hold to Record"**
4. Speak your question in any language
5. Click **"Stop Recording"**
6. Wait for processing (speech-to-text → AI response → text-to-speech)
7. The AI response will play automatically!

## Supported Languages

The feature supports **all languages** that both OpenAI Whisper and ElevenLabs support, including:

- English, Spanish, French, German, Italian, Portuguese
- Hindi, Japanese, Korean, Chinese, Arabic
- Russian, Turkish, Dutch, Swedish, Indonesian
- Filipino, Vietnamese, Thai
- And many more!

## Features

✅ Automatic language detection  
✅ Natural, conversational responses  
✅ High-quality voice synthesis  
✅ Works alongside YouTube translation  
✅ No manual language selection needed  
✅ Real-time audio recording  

## API Endpoints

### POST `/api/conversation/ask`
- **Body**: FormData with `audio` file (webm format)
- **Response**: JSON with question text, response text, detected language, and audio (base64)

### GET `/api/conversation/status`
- **Response**: API readiness status

## Troubleshooting

### Microphone Access Denied
- Allow microphone permissions in Chrome settings
- Click the lock icon in the address bar → Site settings → Microphone

### "Failed to process audio"
- Ensure OpenAI API key is valid and has credits
- Check server console for detailed error logs

### No Audio Playback
- Check browser audio settings
- Ensure ElevenLabs API key is valid
- Check browser console for errors

### Server Not Starting
- Ensure Redis is running: `redis-server`
- Check if port 3001 is available
- Verify all environment variables are set

## Cost Considerations

- **OpenAI Whisper**: ~$0.006 per minute of audio
- **OpenAI GPT-4o-mini**: ~$0.00015 per response (very cheap!)
- **ElevenLabs TTS**: Varies by plan (includes free tier)

A typical conversation (30-second question + response) costs less than $0.01!

## Architecture

```
User Audio Recording (Browser)
    ↓
POST /api/conversation/ask
    ↓
OpenAI Whisper (Speech → Text)
    ↓
OpenAI GPT-4o-mini (Generate Response)
    ↓
ElevenLabs TTS (Text → Speech)
    ↓
Audio Response (Browser Playback)
```

## Files Modified/Created

### Backend:
- `server/src/services/conversational-ai.ts` - Core AI logic
- `server/src/routes/conversation.ts` - API endpoints
- `server/src/index.ts` - Route registration

### Frontend:
- `pages/side-panel/src/ConversationPanel.tsx` - UI component
- `pages/side-panel/src/SidePanel.tsx` - Integration

### Configuration:
- `server/package.json` - Dependencies
- `requirements.txt` - Python dependencies
- `.example.env` - Environment template

## Next Steps

Consider adding:
- Voice selection for responses
- Conversation history storage
- Multilingual conversations (ask in one language, respond in another)
- Integration with YouTube video context
- Custom AI personalities/assistants

