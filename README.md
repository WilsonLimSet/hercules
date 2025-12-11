# Hercules

Real-time YouTube video translation powered by ElevenLabs AI dubbing.

![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/Typescript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://badges.aleen42.com/src/vitejs.svg)

## What is Hercules?

Hercules is a Chrome extension that translates YouTube videos into 20+ languages in real-time. It uses ElevenLabs' AI dubbing technology to preserve the original speaker's voice characteristics while translating the content.

### Supported Languages

English, Spanish, French, German, Italian, Portuguese, Polish, Hindi, Japanese, Korean, Chinese, Arabic, Russian, Turkish, Dutch, Swedish, Indonesian, Filipino, Vietnamese, Thai

## How It Works

1. Navigate to any YouTube video
2. Open the Hercules side panel
3. Select your target language
4. Click "Translate Video"
5. Wait for ElevenLabs to process the video (2-5 minutes depending on length)
6. The dubbed audio plays in sync with the video while the original audio is lowered

## Architecture

```
hercules/
├── chrome-extension/     # Extension manifest and background scripts
├── pages/
│   ├── side-panel/       # Language selection UI
│   └── content/          # YouTube video integration
├── packages/             # Shared utilities and storage
└── server/               # Backend API with Redis caching
```

### Backend Server

- **Express.js** API server
- **Redis** for job queuing and caching dubbed videos (7-day cache)
- **ElevenLabs API** integration for AI dubbing

### Chrome Extension

- **Side Panel** - Clean UI for language selection and playback control
- **Content Script** - Syncs dubbed audio with YouTube video (handles play/pause, seek, speed changes)

## Installation

### Prerequisites

- Node.js >= 18
- pnpm (`npm install -g pnpm`)
- Redis server running locally
- ElevenLabs API key

### Backend Setup

```bash
cd server
cp .env.example .env
# Add your ELEVENLABS_API_KEY to .env

# Start Redis (if not already running)
redis-server

# Start the server
npm run dev
```

### Extension Setup

```bash
# Install dependencies
pnpm install

# Development mode (with hot reload)
pnpm dev

# Or production build
pnpm build
```

### Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder

## Configuration

### Environment Variables

Create a `.env` file in the `server` directory:

```env
ELEVENLABS_API_KEY=your_api_key_here
REDIS_URL=redis://localhost:6379
PORT=3001
```

### Extension Settings

The extension stores settings in Chrome's local storage:
- Target language (default: Spanish)
- Volume level (default: 100%)
- Server URL (default: http://localhost:3001)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dubbing/languages` | GET | Get supported languages |
| `/api/dubbing/create` | POST | Create a new dubbing job |
| `/api/dubbing/status/:jobId` | GET | Check job status |
| `/api/dubbing/audio/:dubbingId/:lang` | GET | Stream dubbed audio |
| `/health` | GET | Health check |

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **Build**: Vite, Turborepo
- **Backend**: Express.js, Redis
- **AI**: ElevenLabs Dubbing API

## Limitations

- ElevenLabs dubbing is not truly real-time - videos need to be processed first
- Processing time: ~2-5 minutes for a 10-minute video
- Maximum video length: 2.5 hours
- Requires ElevenLabs API credits

## License

ISC
