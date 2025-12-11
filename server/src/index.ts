import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { dubbingRouter } from './routes/dubbing';
import { ttsRouter } from './routes/tts-translate';

const app = express();
const PORT = process.env.PORT || 3001;

// Redis client
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis'));

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/dubbing', dubbingRouter);
app.use('/api/tts', ttsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', redis: redisClient.isOpen });
});

// Start server
async function start() {
  try {
    await redisClient.connect();
    app.listen(PORT, () => {
      console.log(`Hercules server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
