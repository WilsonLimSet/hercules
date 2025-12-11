import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import { dubbingRouter } from './routes/dubbing';

dotenv.config();

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
