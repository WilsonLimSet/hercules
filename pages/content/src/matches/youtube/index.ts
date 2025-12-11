// Hercules YouTube Content Script
// Real-time video translation with audio overlay

console.log('[Hercules] YouTube content script loaded');

const CHUNK_DURATION = 30;
const POLL_INTERVAL = 2000; // Poll for chunk status every 2 seconds

interface ChunkResult {
  chunkIndex: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  error?: string;
}

interface SessionConfig {
  sessionId: string;
  serverUrl: string;
  targetLang: string;
  volume: number;
}

let session: SessionConfig | null = null;
let videoElement: HTMLVideoElement | null = null;
let currentAudio: HTMLAudioElement | null = null;
let nextAudio: HTMLAudioElement | null = null;
let currentChunkIndex = -1;
let isActive = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let muteOverlay: HTMLDivElement | null = null;

// Find YouTube video element
const getVideoElement = (): HTMLVideoElement | null => {
  return document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
};

// Create audio element
const createAudio = (url: string, volume: number): HTMLAudioElement => {
  const audio = new Audio(url);
  audio.volume = volume / 100;
  audio.crossOrigin = 'anonymous';
  return audio;
};

// Get chunk index for a timestamp
const getChunkIndex = (time: number): number => Math.floor(time / CHUNK_DURATION);

// Request chunks from server (current + next in parallel)
const requestChunks = async (currentTime: number): Promise<{ current: ChunkResult; next: ChunkResult | null }> => {
  if (!session) throw new Error('No active session');

  const response = await fetch(`${session.serverUrl}/api/dubbing/session/${session.sessionId}/chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentTime }),
  });

  if (!response.ok) throw new Error('Failed to request chunks');
  return response.json();
};

// Get chunk status
const getChunkStatus = async (chunkIndex: number): Promise<ChunkResult | null> => {
  if (!session) return null;

  try {
    const response = await fetch(
      `${session.serverUrl}/api/dubbing/session/${session.sessionId}/chunk/${chunkIndex}`
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
};

// Preload next chunk audio
const preloadNextChunk = async (chunkIndex: number): Promise<void> => {
  const chunk = await getChunkStatus(chunkIndex);
  if (chunk?.status === 'completed' && chunk.audioUrl && session) {
    nextAudio = createAudio(`${session.serverUrl}${chunk.audioUrl}`, session.volume);
    nextAudio.preload = 'auto';
    console.log(`[Hercules] Preloaded chunk ${chunkIndex}`);
  }
};

// Switch to next chunk audio
const switchToChunk = async (chunk: ChunkResult): Promise<void> => {
  if (!session || !videoElement || !chunk.audioUrl) return;

  // Use preloaded audio if available
  if (nextAudio && currentChunkIndex + 1 === chunk.chunkIndex) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
    }
    currentAudio = nextAudio;
    nextAudio = null;
  } else {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
    }
    currentAudio = createAudio(`${session.serverUrl}${chunk.audioUrl}`, session.volume);
  }

  currentChunkIndex = chunk.chunkIndex;

  // Sync position within chunk
  const offsetInChunk = videoElement.currentTime - chunk.startTime;
  currentAudio.currentTime = Math.max(0, Math.min(offsetInChunk, CHUNK_DURATION));
  currentAudio.playbackRate = videoElement.playbackRate;

  // Play if video is playing
  if (!videoElement.paused) {
    try {
      await currentAudio.play();
    } catch (error) {
      console.error('[Hercules] Failed to play audio:', error);
    }
  }

  // Preload next chunk
  preloadNextChunk(chunk.chunkIndex + 1);
};

// Main update loop
const updatePlayback = async (): Promise<void> => {
  if (!session || !videoElement || !isActive) return;

  const currentTime = videoElement.currentTime;
  const neededChunkIndex = getChunkIndex(currentTime);

  // Need different chunk?
  if (neededChunkIndex !== currentChunkIndex) {
    console.log(`[Hercules] Need chunk ${neededChunkIndex}, have ${currentChunkIndex}`);

    // Request chunks (current + next in parallel)
    try {
      const { current } = await requestChunks(currentTime);

      if (current.status === 'completed' && current.audioUrl) {
        await switchToChunk(current);
      } else {
        console.log(`[Hercules] Chunk ${neededChunkIndex} status: ${current.status}`);
        // Keep polling until ready
      }
    } catch (error) {
      console.error('[Hercules] Failed to request chunks:', error);
    }
  }

  // Sync audio time
  if (currentAudio && !videoElement.paused) {
    const chunkStartTime = currentChunkIndex * CHUNK_DURATION;
    const expectedOffset = currentTime - chunkStartTime;
    const drift = Math.abs(currentAudio.currentTime - expectedOffset);

    if (drift > 0.5) {
      currentAudio.currentTime = Math.max(0, expectedOffset);
    }
  }
};

// Create mute overlay UI
const createMuteOverlay = (): void => {
  if (muteOverlay) return;

  muteOverlay = document.createElement('div');
  muteOverlay.id = 'hercules-overlay';
  muteOverlay.innerHTML = `
    <style>
      #hercules-overlay {
        position: fixed;
        bottom: 100px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #hercules-overlay:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 24px rgba(0,0,0,0.4);
      }
      #hercules-overlay .hercules-icon {
        font-size: 24px;
      }
      #hercules-overlay .hercules-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      #hercules-overlay .hercules-title {
        font-weight: 600;
      }
      #hercules-overlay .hercules-subtitle {
        font-size: 12px;
        opacity: 0.9;
      }
      #hercules-overlay .hercules-close {
        margin-left: 8px;
        opacity: 0.7;
        font-size: 18px;
      }
      #hercules-overlay .hercules-close:hover {
        opacity: 1;
      }
    </style>
    <span class="hercules-icon">🦁</span>
    <div class="hercules-text">
      <span class="hercules-title">Hercules Active</span>
      <span class="hercules-subtitle">Translating audio...</span>
    </div>
    <span class="hercules-close" id="hercules-close">✕</span>
  `;

  document.body.appendChild(muteOverlay);

  // Close button
  document.getElementById('hercules-close')?.addEventListener('click', e => {
    e.stopPropagation();
    stopTranslation();
    chrome.runtime.sendMessage({ type: 'HERCULES_STOPPED' });
  });
};

const updateOverlayStatus = (status: string): void => {
  const subtitle = muteOverlay?.querySelector('.hercules-subtitle');
  if (subtitle) subtitle.textContent = status;
};

const removeOverlay = (): void => {
  muteOverlay?.remove();
  muteOverlay = null;
};

// Video event handlers
const handleVideoPlay = (): void => {
  if (currentAudio && isActive) {
    currentAudio.play().catch(console.error);
  }
};

const handleVideoPause = (): void => {
  currentAudio?.pause();
};

const handleVideoSeeked = (): void => {
  updatePlayback();
};

const handleRateChange = (): void => {
  if (currentAudio && videoElement) {
    currentAudio.playbackRate = videoElement.playbackRate;
  }
};

// Start translation
const startTranslation = async (config: SessionConfig): Promise<void> => {
  stopTranslation(); // Clean up any existing session

  videoElement = getVideoElement();
  if (!videoElement) {
    console.error('[Hercules] No video element found');
    return;
  }

  session = config;
  isActive = true;

  // Mute original video
  videoElement.volume = 0.1;

  // Add event listeners
  videoElement.addEventListener('play', handleVideoPlay);
  videoElement.addEventListener('pause', handleVideoPause);
  videoElement.addEventListener('seeked', handleVideoSeeked);
  videoElement.addEventListener('ratechange', handleRateChange);

  // Create overlay
  createMuteOverlay();
  updateOverlayStatus('Starting translation...');

  // Start update loop
  pollInterval = setInterval(updatePlayback, POLL_INTERVAL);

  // Initial request
  await updatePlayback();

  console.log('[Hercules] Translation started');
};

// Stop translation
const stopTranslation = (): void => {
  isActive = false;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }

  if (nextAudio) {
    nextAudio.src = '';
    nextAudio = null;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  if (videoElement) {
    videoElement.volume = 1;
    videoElement.removeEventListener('play', handleVideoPlay);
    videoElement.removeEventListener('pause', handleVideoPause);
    videoElement.removeEventListener('seeked', handleVideoSeeked);
    videoElement.removeEventListener('ratechange', handleRateChange);
    videoElement = null;
  }

  removeOverlay();
  session = null;
  currentChunkIndex = -1;

  console.log('[Hercules] Translation stopped');
};

// Update volume
const updateVolume = (volume: number): void => {
  if (session) session.volume = volume;
  if (currentAudio) currentAudio.volume = volume / 100;
  if (nextAudio) nextAudio.volume = volume / 100;
};

// Message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Hercules] Message:', message.type);

  switch (message.type) {
    case 'HERCULES_START':
      startTranslation({
        sessionId: message.sessionId,
        serverUrl: message.serverUrl,
        targetLang: message.targetLang,
        volume: message.volume,
      });
      sendResponse({ success: true });
      break;

    case 'HERCULES_STOP':
      stopTranslation();
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
      });
      break;

    case 'HERCULES_UPDATE_STATUS':
      updateOverlayStatus(message.status);
      sendResponse({ success: true });
      break;
  }

  return true;
});

// Cleanup on navigation
window.addEventListener('beforeunload', stopTranslation);

// Handle YouTube SPA navigation
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    stopTranslation();
  }
});
observer.observe(document.body, { childList: true, subtree: true });
