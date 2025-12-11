// Hercules YouTube Content Script
// Handles chunk-based audio playback sync with YouTube videos

console.log('[Hercules] YouTube content script loaded');

const CHUNK_DURATION = 30; // Must match server config

interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  dubbingId?: string;
  audioUrl?: string;
}

interface JobInfo {
  id: string;
  chunks: ChunkInfo[];
  serverUrl: string;
  volume: number;
  targetLang: string;
}

let currentJob: JobInfo | null = null;
let videoElement: HTMLVideoElement | null = null;
let currentChunkAudio: HTMLAudioElement | null = null;
let currentChunkIndex = -1;
let isActive = false;
let checkInterval: ReturnType<typeof setInterval> | null = null;

// Find the YouTube video element
const getVideoElement = (): HTMLVideoElement | null => {
  return document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
};

// Create audio element for a chunk
const createChunkAudio = (audioUrl: string, volume: number): HTMLAudioElement => {
  const audio = new Audio(audioUrl);
  audio.volume = volume / 100;
  audio.crossOrigin = 'anonymous';
  return audio;
};

// Get the chunk index for a given time
const getChunkIndex = (time: number): number => {
  return Math.floor(time / CHUNK_DURATION);
};

// Fetch chunk status from server
const fetchChunkStatus = async (jobId: string, chunkIndex: number, serverUrl: string): Promise<ChunkInfo | null> => {
  try {
    const response = await fetch(`${serverUrl}/api/dubbing/chunk/${jobId}/${chunkIndex * CHUNK_DURATION}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('[Hercules] Failed to fetch chunk status:', error);
    return null;
  }
};

// Request a chunk to be processed
const requestChunkProcessing = async (jobId: string, chunkIndex: number, serverUrl: string): Promise<void> => {
  try {
    await fetch(`${serverUrl}/api/dubbing/chunk/${jobId}/${chunkIndex}`, { method: 'POST' });
  } catch (error) {
    console.error('[Hercules] Failed to request chunk:', error);
  }
};

// Switch to a new chunk's audio
const switchToChunk = async (chunk: ChunkInfo): Promise<void> => {
  if (!currentJob || !videoElement || !chunk.audioUrl) return;

  // Stop current audio
  if (currentChunkAudio) {
    currentChunkAudio.pause();
    currentChunkAudio.src = '';
  }

  const fullAudioUrl = `${currentJob.serverUrl}${chunk.audioUrl}`;
  console.log(`[Hercules] Switching to chunk ${chunk.index}: ${fullAudioUrl}`);

  currentChunkAudio = createChunkAudio(fullAudioUrl, currentJob.volume);
  currentChunkIndex = chunk.index;

  // Calculate offset within the chunk
  const offsetInChunk = videoElement.currentTime - chunk.startTime;
  currentChunkAudio.currentTime = Math.max(0, offsetInChunk);

  // Match playback rate
  currentChunkAudio.playbackRate = videoElement.playbackRate;

  // Start playing if video is playing
  if (!videoElement.paused) {
    try {
      await currentChunkAudio.play();
    } catch (error) {
      console.error('[Hercules] Failed to play chunk audio:', error);
    }
  }
};

// Check and update current chunk based on video time
const checkCurrentChunk = async (): Promise<void> => {
  if (!currentJob || !videoElement || !isActive) return;

  const currentTime = videoElement.currentTime;
  const neededChunkIndex = getChunkIndex(currentTime);

  // If we need a different chunk
  if (neededChunkIndex !== currentChunkIndex) {
    const chunk = currentJob.chunks[neededChunkIndex];

    if (!chunk) {
      console.log(`[Hercules] Chunk ${neededChunkIndex} not available yet`);
      return;
    }

    if (chunk.status === 'completed' && chunk.audioUrl) {
      await switchToChunk(chunk);
    } else if (chunk.status === 'pending') {
      // Request this chunk to be processed
      await requestChunkProcessing(currentJob.id, neededChunkIndex, currentJob.serverUrl);
      console.log(`[Hercules] Requested chunk ${neededChunkIndex} to be processed`);
    } else {
      console.log(`[Hercules] Chunk ${neededChunkIndex} status: ${chunk.status}`);
    }
  }

  // Sync audio time if playing
  if (currentChunkAudio && !videoElement.paused) {
    const chunk = currentJob.chunks[currentChunkIndex];
    if (chunk) {
      const expectedOffset = currentTime - chunk.startTime;
      const actualOffset = currentChunkAudio.currentTime;
      const drift = Math.abs(expectedOffset - actualOffset);

      if (drift > 0.3) {
        currentChunkAudio.currentTime = Math.max(0, expectedOffset);
      }
    }
  }
};

// Poll server for job updates
const pollJobStatus = async (): Promise<void> => {
  if (!currentJob) return;

  try {
    const response = await fetch(`${currentJob.serverUrl}/api/dubbing/status/${currentJob.id}`);
    if (!response.ok) return;

    const job = await response.json();
    currentJob.chunks = job.chunks;

    // Check if we can now play a chunk we were waiting for
    await checkCurrentChunk();
  } catch (error) {
    console.error('[Hercules] Failed to poll job status:', error);
  }
};

// Handle video play event
const handleVideoPlay = (): void => {
  if (currentChunkAudio && isActive) {
    currentChunkAudio.play().catch(console.error);
  }
};

// Handle video pause event
const handleVideoPause = (): void => {
  if (currentChunkAudio) {
    currentChunkAudio.pause();
  }
};

// Handle video seek event
const handleVideoSeeked = async (): Promise<void> => {
  await checkCurrentChunk();
};

// Handle playback rate change
const handleRateChange = (): void => {
  if (currentChunkAudio && videoElement) {
    currentChunkAudio.playbackRate = videoElement.playbackRate;
  }
};

// Start chunk-based playback
const startChunkPlayback = async (jobId: string, chunks: ChunkInfo[], serverUrl: string, volume: number, targetLang: string): Promise<void> => {
  // Stop any existing playback
  stopPlayback();

  videoElement = getVideoElement();
  if (!videoElement) {
    console.error('[Hercules] Could not find YouTube video element');
    return;
  }

  currentJob = { id: jobId, chunks, serverUrl, volume, targetLang };
  isActive = true;

  // Lower original video volume
  videoElement.volume = 0.1;

  // Set up event listeners
  videoElement.addEventListener('play', handleVideoPlay);
  videoElement.addEventListener('pause', handleVideoPause);
  videoElement.addEventListener('seeked', handleVideoSeeked);
  videoElement.addEventListener('ratechange', handleRateChange);

  // Start checking chunks
  checkInterval = setInterval(async () => {
    await checkCurrentChunk();
    await pollJobStatus();
  }, 1000);

  // Initial check
  await checkCurrentChunk();

  console.log('[Hercules] Started chunk-based playback');
};

// Stop playback and cleanup
const stopPlayback = (): void => {
  if (currentChunkAudio) {
    currentChunkAudio.pause();
    currentChunkAudio.src = '';
    currentChunkAudio = null;
  }

  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  if (videoElement) {
    videoElement.volume = 1;
    videoElement.removeEventListener('play', handleVideoPlay);
    videoElement.removeEventListener('pause', handleVideoPause);
    videoElement.removeEventListener('seeked', handleVideoSeeked);
    videoElement.removeEventListener('ratechange', handleRateChange);
    videoElement = null;
  }

  currentJob = null;
  currentChunkIndex = -1;
  isActive = false;

  console.log('[Hercules] Stopped playback');
};

// Update volume
const updateVolume = (volume: number): void => {
  if (currentJob) {
    currentJob.volume = volume;
  }
  if (currentChunkAudio) {
    currentChunkAudio.volume = volume / 100;
  }
};

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Hercules] Received message:', message.type);

  switch (message.type) {
    case 'HERCULES_START_CHUNKS':
      startChunkPlayback(
        message.jobId,
        message.chunks,
        message.serverUrl,
        message.volume,
        message.targetLang
      );
      sendResponse({ success: true });
      break;

    case 'HERCULES_STOP':
      stopPlayback();
      sendResponse({ success: true });
      break;

    case 'HERCULES_SET_VOLUME':
      updateVolume(message.volume);
      sendResponse({ success: true });
      break;

    case 'HERCULES_GET_STATUS':
      sendResponse({
        isActive,
        currentChunkIndex,
        currentTime: videoElement?.currentTime || 0,
        chunksReady: currentJob?.chunks.filter(c => c.status === 'completed').length || 0,
        totalChunks: currentJob?.chunks.length || 0,
      });
      break;

    case 'HERCULES_UPDATE_CHUNKS':
      if (currentJob) {
        currentJob.chunks = message.chunks;
        checkCurrentChunk();
      }
      sendResponse({ success: true });
      break;

    // Legacy support for old single-audio approach
    case 'HERCULES_PLAY_DUBBED':
      // Convert to chunk-based if possible
      sendResponse({ success: false, error: 'Use HERCULES_START_CHUNKS instead' });
      break;
  }

  return true;
});

// Clean up when navigating away
window.addEventListener('beforeunload', stopPlayback);

// Handle YouTube SPA navigation
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    stopPlayback();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
