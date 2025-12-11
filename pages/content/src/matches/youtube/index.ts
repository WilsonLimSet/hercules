// Hercules YouTube Content Script
// Real-time video translation with TTS

console.log('[Hercules] YouTube content script loaded');

interface Segment {
  index: number;
  text?: string;
  startTime: number;
  endTime: number;
}

interface SegmentResponse {
  segment: Segment | null;
  status: 'ready' | 'translating' | 'generating_audio' | 'no_segment';
  audioUrl?: string;
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
let currentSegmentIndex = -1;
let isActive = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let overlay: HTMLDivElement | null = null;
let playedSegments: Set<number> = new Set(); // Track segments we've already played
let preloadedAudio: Map<number, HTMLAudioElement> = new Map(); // Preloaded audio by segment index
let preloadingSegments: Set<number> = new Set(); // Segments currently being preloaded

// Find YouTube video element
const getVideoElement = (): HTMLVideoElement | null => {
  return document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
};

// Request segment for current time
const requestSegment = async (currentTime: number): Promise<SegmentResponse> => {
  if (!session) throw new Error('No active session');

  const response = await fetch(`${session.serverUrl}/api/tts/session/${session.sessionId}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentTime }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    if (error.error === 'Session not found' || response.status === 404) {
      console.error('[Hercules] Session expired');
      stopTranslation();
      chrome.runtime.sendMessage({ type: 'HERCULES_SESSION_EXPIRED' });
      throw new Error('Session expired');
    }
    throw new Error(error.error || 'Failed to request segment');
  }
  return response.json();
};

// Send status update
const sendStatus = (status: string): void => {
  updateOverlayStatus(status);
  chrome.runtime.sendMessage({ type: 'HERCULES_STATUS_UPDATE', status }).catch(() => {});
};

// Send subtitle to side panel
const sendSubtitle = (text: string): void => {
  chrome.runtime.sendMessage({ type: 'HERCULES_SUBTITLE', subtitle: text }).catch(() => {});
};

// Preload audio for a segment
const preloadSegmentAudio = async (segmentIndex: number): Promise<void> => {
  if (!session || preloadedAudio.has(segmentIndex) || preloadingSegments.has(segmentIndex)) {
    return;
  }

  preloadingSegments.add(segmentIndex);

  try {
    // Request segment info from server
    const response = await fetch(`${session.serverUrl}/api/tts/session/${session.sessionId}/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segmentIndex }), // Request by index for preloading
    });

    if (!response.ok) return;

    const data = await response.json();
    if (data.status === 'ready' && data.audioUrl) {
      const audio = new Audio(`${session.serverUrl}${data.audioUrl}`);
      audio.volume = session.volume / 100;
      audio.preload = 'auto';

      // Wait for audio to be loaded
      await new Promise<void>((resolve) => {
        audio.oncanplaythrough = () => resolve();
        audio.onerror = () => resolve();
        audio.load();
      });

      preloadedAudio.set(segmentIndex, audio);
      console.log(`[Hercules] Preloaded segment ${segmentIndex}`);
    }
  } catch (error) {
    console.error(`[Hercules] Failed to preload segment ${segmentIndex}:`, error);
  } finally {
    preloadingSegments.delete(segmentIndex);
  }
};

// Play audio for a segment
const playSegmentAudio = async (audioUrl: string, segment: Segment): Promise<void> => {
  if (!session || !videoElement) return;

  // Skip if we've already played this segment
  if (playedSegments.has(segment.index)) {
    return;
  }

  // If audio is currently playing, preload this one for later
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) {
    if (!preloadedAudio.has(segment.index) && !preloadingSegments.has(segment.index)) {
      const audio = new Audio(`${session.serverUrl}${audioUrl}`);
      audio.volume = session.volume / 100;
      audio.preload = 'auto';
      preloadedAudio.set(segment.index, audio);
      console.log(`[Hercules] Queued segment ${segment.index} for preload`);
    }
    return;
  }

  // Stop current audio if any
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
  }

  // Use preloaded audio if available
  if (preloadedAudio.has(segment.index)) {
    currentAudio = preloadedAudio.get(segment.index)!;
    preloadedAudio.delete(segment.index);
    console.log(`[Hercules] Using preloaded audio for segment ${segment.index}`);
  } else {
    currentAudio = new Audio(`${session.serverUrl}${audioUrl}`);
    currentAudio.volume = session.volume / 100;
  }

  currentSegmentIndex = segment.index;
  playedSegments.add(segment.index);

  // Track when audio finishes - immediately try to play next preloaded segment
  currentAudio.onended = () => {
    console.log(`[Hercules] Segment ${segment.index} audio finished`);

    // Try to play next preloaded segment immediately
    const nextIndex = segment.index + 1;
    if (preloadedAudio.has(nextIndex) && !playedSegments.has(nextIndex) && isActive) {
      const nextAudio = preloadedAudio.get(nextIndex)!;
      preloadedAudio.delete(nextIndex);

      currentAudio = nextAudio;
      currentSegmentIndex = nextIndex;
      playedSegments.add(nextIndex);

      currentAudio.onended = () => {
        console.log(`[Hercules] Segment ${nextIndex} audio finished`);
        sendSubtitle('');
      };

      currentAudio.play().catch(console.error);
      console.log(`[Hercules] Auto-playing next segment ${nextIndex}`);

      // Get the subtitle for next segment from server (async, don't wait)
      requestSegment(videoElement?.currentTime || 0).then(resp => {
        if (resp.segment?.text) sendSubtitle(resp.segment.text);
      }).catch(() => {});
    } else {
      sendSubtitle('');
    }
  };

  currentAudio.onerror = () => {
    console.error(`[Hercules] Audio error for segment ${segment.index}`);
  };

  // Play the audio
  try {
    await currentAudio.play();
    console.log(`[Hercules] Playing segment ${segment.index}: "${segment.text?.substring(0, 30)}..."`);

    // Send subtitle
    if (segment.text) {
      sendSubtitle(segment.text);
    }

    // Preload next 2 segments
    preloadSegmentAudio(segment.index + 1);
    preloadSegmentAudio(segment.index + 2);
  } catch (error) {
    console.error('[Hercules] Failed to play audio:', error);
  }
};

// Main update loop
const updatePlayback = async (): Promise<void> => {
  if (!session || !videoElement || !isActive) return;

  const currentTime = videoElement.currentTime;

  try {
    const response = await requestSegment(currentTime);

    if (response.status === 'no_segment') {
      // No speech at this time
      if (currentAudio && !currentAudio.paused) {
        // Let current audio finish
      }
      return;
    }

    if (!response.segment) return;

    // Only act if this is a different segment
    if (response.segment.index === currentSegmentIndex) {
      return;
    }

    if (response.status === 'ready' && response.audioUrl) {
      sendStatus(`Playing: "${response.segment.text?.substring(0, 25)}..."`);
      await playSegmentAudio(response.audioUrl, response.segment);
    } else if (response.status === 'generating_audio') {
      sendStatus(`Generating audio for segment ${response.segment.index}...`);
    } else if (response.status === 'translating') {
      sendStatus(`Translating segment ${response.segment.index}...`);
    }
  } catch (error) {
    console.error('[Hercules] Update error:', error);
  }
};

// Create overlay UI
const createOverlay = (): void => {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.id = 'hercules-overlay';
  overlay.innerHTML = `
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
        max-width: 350px;
      }
      #hercules-overlay .hercules-icon { font-size: 24px; }
      #hercules-overlay .hercules-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      #hercules-overlay .hercules-title { font-weight: 600; }
      #hercules-overlay .hercules-subtitle { font-size: 11px; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px; }
      #hercules-overlay .hercules-close { opacity: 0.7; font-size: 18px; cursor: pointer; }
      #hercules-overlay .hercules-close:hover { opacity: 1; }
    </style>
    <span class="hercules-icon">🦁</span>
    <div class="hercules-text">
      <span class="hercules-title">Hercules TTS</span>
      <span class="hercules-subtitle">Starting...</span>
    </div>
    <span class="hercules-close" id="hercules-close">✕</span>
  `;

  document.body.appendChild(overlay);

  document.getElementById('hercules-close')?.addEventListener('click', e => {
    e.stopPropagation();
    stopTranslation();
    chrome.runtime.sendMessage({ type: 'HERCULES_STOPPED' });
  });
};

const updateOverlayStatus = (status: string): void => {
  const subtitle = overlay?.querySelector('.hercules-subtitle');
  if (subtitle) subtitle.textContent = status;
};

const removeOverlay = (): void => {
  overlay?.remove();
  overlay = null;
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
  currentSegmentIndex = -1;
  playedSegments.clear(); // Clear on seek so segments can replay
  preloadedAudio.clear();
  preloadingSegments.clear();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  updatePlayback();
};

// Start translation
const startTranslation = async (config: SessionConfig): Promise<void> => {
  stopTranslation();

  videoElement = getVideoElement();
  if (!videoElement) {
    console.error('[Hercules] No video element found');
    sendStatus('Error: No video element found');
    return;
  }

  session = config;
  isActive = true;

  // Lower original video volume
  videoElement.volume = 0.15;

  // Add event listeners
  videoElement.addEventListener('play', handleVideoPlay);
  videoElement.addEventListener('pause', handleVideoPause);
  videoElement.addEventListener('seeked', handleVideoSeeked);

  // Create overlay
  createOverlay();
  sendStatus('Ready - translating as you watch');

  // Poll every 300ms for responsive playback
  pollInterval = setInterval(updatePlayback, 300);

  // Initial request
  await updatePlayback();

  console.log('[Hercules] TTS Translation started');
};

// Stop translation
const stopTranslation = (): void => {
  isActive = false;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }

  // Clear all preloaded audio
  preloadedAudio.forEach(audio => {
    audio.src = '';
  });
  preloadedAudio.clear();
  preloadingSegments.clear();

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  if (videoElement) {
    videoElement.volume = 1;
    videoElement.removeEventListener('play', handleVideoPlay);
    videoElement.removeEventListener('pause', handleVideoPause);
    videoElement.removeEventListener('seeked', handleVideoSeeked);
    videoElement = null;
  }

  removeOverlay();
  sendSubtitle(''); // Clear subtitle
  session = null;
  currentSegmentIndex = -1;
  playedSegments.clear();

  console.log('[Hercules] Translation stopped');
};

// Update volume
const updateVolume = (volume: number): void => {
  if (session) session.volume = volume;
  if (currentAudio) currentAudio.volume = volume / 100;
};

// Start synced playback - seeks to start and plays video
const startSyncedPlayback = (): void => {
  if (!videoElement) return;

  // Reset all playback state
  currentSegmentIndex = -1;
  playedSegments.clear();
  preloadedAudio.forEach(audio => { audio.src = ''; });
  preloadedAudio.clear();
  preloadingSegments.clear();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }

  videoElement.currentTime = 0;
  videoElement.play().catch(console.error);

  console.log('[Hercules] Starting synced playback from beginning');
  sendStatus('Playing synced from start');
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
        currentSegmentIndex,
        currentTime: videoElement?.currentTime || 0,
      });
      break;

    case 'HERCULES_PLAY_SYNCED':
      startSyncedPlayback();
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
