// Hercules YouTube Content Script
// Handles audio playback sync with YouTube videos

console.log('[Hercules] YouTube content script loaded');

let dubbedAudio: HTMLAudioElement | null = null;
let videoElement: HTMLVideoElement | null = null;
let isPlaying = false;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// Find the YouTube video element
const getVideoElement = (): HTMLVideoElement | null => {
  return document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
};

// Create and configure the dubbed audio element
const createAudioElement = (audioUrl: string, volume: number): HTMLAudioElement => {
  const audio = new Audio(audioUrl);
  audio.volume = volume / 100;
  audio.crossOrigin = 'anonymous';
  return audio;
};

// Sync dubbed audio with video playback
const syncAudioWithVideo = () => {
  if (!dubbedAudio || !videoElement) return;

  // Sync play/pause state
  if (videoElement.paused && !dubbedAudio.paused) {
    dubbedAudio.pause();
  } else if (!videoElement.paused && dubbedAudio.paused && isPlaying) {
    dubbedAudio.play().catch(console.error);
  }

  // Sync time if drift is more than 0.3 seconds
  const timeDiff = Math.abs(dubbedAudio.currentTime - videoElement.currentTime);
  if (timeDiff > 0.3) {
    dubbedAudio.currentTime = videoElement.currentTime;
  }

  // Sync playback rate
  if (dubbedAudio.playbackRate !== videoElement.playbackRate) {
    dubbedAudio.playbackRate = videoElement.playbackRate;
  }
};

const handleVideoPlay = () => {
  if (dubbedAudio && isPlaying) {
    dubbedAudio.play().catch(console.error);
  }
};

const handleVideoPause = () => {
  if (dubbedAudio) {
    dubbedAudio.pause();
  }
};

const handleVideoSeeked = () => {
  if (dubbedAudio && videoElement) {
    dubbedAudio.currentTime = videoElement.currentTime;
  }
};

const handleRateChange = () => {
  if (dubbedAudio && videoElement) {
    dubbedAudio.playbackRate = videoElement.playbackRate;
  }
};

// Stop playback and cleanup
const stopPlayback = () => {
  if (dubbedAudio) {
    dubbedAudio.pause();
    dubbedAudio.src = '';
    dubbedAudio = null;
  }

  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }

  if (videoElement) {
    videoElement.volume = 1;
    videoElement.removeEventListener('play', handleVideoPlay);
    videoElement.removeEventListener('pause', handleVideoPause);
    videoElement.removeEventListener('seeked', handleVideoSeeked);
    videoElement.removeEventListener('ratechange', handleRateChange);
    videoElement = null;
  }

  isPlaying = false;
  console.log('[Hercules] Stopped dubbed audio playback');
};

// Update volume
const updateVolume = (volume: number) => {
  if (dubbedAudio) {
    dubbedAudio.volume = volume / 100;
  }
};

// Start playing dubbed audio
const playDubbedAudio = async (audioUrl: string, volume: number) => {
  // Stop any existing playback
  stopPlayback();

  videoElement = getVideoElement();
  if (!videoElement) {
    console.error('[Hercules] Could not find YouTube video element');
    return;
  }

  console.log('[Hercules] Starting dubbed audio playback:', audioUrl);

  // Create audio element
  dubbedAudio = createAudioElement(audioUrl, volume);

  // Lower the original video volume
  videoElement.volume = 0.1;

  // Set initial time to match video
  dubbedAudio.currentTime = videoElement.currentTime;

  // Start playback if video is playing
  if (!videoElement.paused) {
    try {
      await dubbedAudio.play();
      isPlaying = true;
    } catch (error) {
      console.error('[Hercules] Failed to play audio:', error);
    }
  }

  // Set up sync interval
  syncInterval = setInterval(syncAudioWithVideo, 100);

  // Listen for video events
  videoElement.addEventListener('play', handleVideoPlay);
  videoElement.addEventListener('pause', handleVideoPause);
  videoElement.addEventListener('seeked', handleVideoSeeked);
  videoElement.addEventListener('ratechange', handleRateChange);
};

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Hercules] Received message:', message.type);

  switch (message.type) {
    case 'HERCULES_PLAY_DUBBED':
      playDubbedAudio(message.audioUrl, message.volume);
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
        isPlaying,
        currentTime: dubbedAudio?.currentTime || 0,
        videoTime: videoElement?.currentTime || 0,
      });
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
