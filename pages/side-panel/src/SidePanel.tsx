import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, herculesStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useState, useEffect } from 'react';

const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  hi: 'Hindi',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  ru: 'Russian',
  tr: 'Turkish',
  nl: 'Dutch',
  sv: 'Swedish',
  id: 'Indonesian',
  fil: 'Filipino',
  vi: 'Vietnamese',
  th: 'Thai',
};

const SidePanel = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const herculesState = useStorage(herculesStorage);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isYouTube, setIsYouTube] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'error' | 'success'>('info');
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [audioReadyCount, setAudioReadyCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');

  const addLog = (msg: string) => {
    console.log('[Hercules]', msg);
    setDebugLog(prev => [...prev.slice(-4), msg]);
  };

  const checkCurrentTab = (logResult = false) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const url = tabs[0]?.url || '';
      setCurrentUrl(url);
      const isYT = url.includes('youtube.com/watch') || url.includes('youtu.be/');
      setIsYouTube(isYT);
      // Only log when explicitly requested (button click), not on periodic checks
      if (logResult) {
        addLog(isYT ? `YouTube: ${url.substring(0, 40)}...` : `Not YouTube`);
      }
    });
  };

  useEffect(() => {
    // Get current tab URL
    checkCurrentTab();

    // Also check periodically (for SPA navigation)
    const interval = setInterval(checkCurrentTab, 2000);

    // Listen for tab changes
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Check if this is the active tab
      if (tab.active && changeInfo.url) {
        console.log('[Hercules] Tab URL changed:', changeInfo.url);
        setCurrentUrl(changeInfo.url);
        setIsYouTube(changeInfo.url.includes('youtube.com/watch') || changeInfo.url.includes('youtu.be/'));
        // Reset state on navigation
        setIsActive(false);
        setSessionId(null);
        setStatus('');
        setDebugLog([]);
      }
    };

    // Listen for tab activation (switching tabs)
    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      console.log('[Hercules] Tab activated:', activeInfo.tabId);
      checkCurrentTab();
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);
    chrome.tabs.onActivated.addListener(handleTabActivated);

    // Listen for messages from content script
    const handleMessage = (message: { type: string; status?: string; subtitle?: string }) => {
      if (message.type === 'HERCULES_STOPPED') {
        setIsActive(false);
        setSessionId(null);
        setStatus('');
        setDebugLog([]);
        setCurrentSubtitle('');
      } else if (message.type === 'HERCULES_SESSION_EXPIRED') {
        setIsActive(false);
        setSessionId(null);
        setStatus('Session expired - server may have restarted. Click Start again.');
        setStatusType('error');
        addLog('Session expired - please restart');
        setCurrentSubtitle('');
      } else if (message.type === 'HERCULES_SUBTITLE' && message.subtitle) {
        setCurrentSubtitle(message.subtitle);
      } else if (message.type === 'HERCULES_STATUS_UPDATE' && message.status) {
        setStatus(message.status);
        if (message.status.includes('Playing')) {
          setStatusType('success');
        } else if (message.status.includes('failed')) {
          setStatusType('error');
        } else {
          setStatusType('info');
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      clearInterval(interval);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleStart = async () => {
    if (!isYouTube) return;

    setIsLoading(true);
    setStatus('Connecting to server...');
    setStatusType('info');
    addLog(`Server: ${herculesState.serverUrl}`);

    try {
      // Test server connection first with timeout
      addLog('Testing server connection...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let healthCheck;
      try {
        healthCheck = await fetch(`${herculesState.serverUrl}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (e: unknown) {
        clearTimeout(timeoutId);
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        if (errorMsg.includes('abort')) {
          throw new Error('Server timeout (5s) - is it running?');
        }
        throw new Error(`Server unreachable: ${errorMsg}`);
      }

      if (!healthCheck.ok) {
        throw new Error(`Server error: ${healthCheck.status}`);
      }

      const healthData = await healthCheck.json();
      addLog(`Server OK, Redis: ${healthData.redis ? 'connected' : 'disconnected'}`);

      // Create TTS session on server
      setStatus('Fetching transcript...');
      addLog(`Creating TTS session for ${currentUrl}`);

      const response = await fetch(`${herculesState.serverUrl}/api/tts/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: currentUrl,
          targetLang: herculesState.targetLanguage,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      const newSessionId = data.sessionId;

      if (!data.totalSegments || data.totalSegments === 0) {
        throw new Error('No transcript available for this video');
      }

      addLog(`Session created: ${newSessionId}`);
      addLog(`Transcript: ${data.totalSegments} segments`);
      setSessionId(newSessionId);

      // Start translation in content script
      setStatus('Starting content script...');
      addLog('Sending message to content script...');

      chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
        if (!tabs[0]?.id) {
          addLog('Error: No active tab found');
          setStatus('Error: No active tab found');
          setStatusType('error');
          setIsLoading(false);
          return;
        }

        const tabId = tabs[0].id;

        // Try to send message, inject script if it fails
        const sendStartMessage = () => {
          chrome.tabs.sendMessage(
            tabId,
            {
              type: 'HERCULES_START',
              sessionId: newSessionId,
              serverUrl: herculesState.serverUrl,
              targetLang: herculesState.targetLanguage,
              volume: herculesState.volume,
              mode: 'tts',
            },
            response => {
              if (chrome.runtime.lastError) {
                const errMsg = chrome.runtime.lastError.message || '';
                if (errMsg.includes('Receiving end does not exist')) {
                  addLog('Content script not loaded, injecting...');
                  // Inject the content script
                  chrome.scripting.executeScript(
                    {
                      target: { tabId },
                      files: ['content/youtube.iife.js'],
                    },
                    () => {
                      if (chrome.runtime.lastError) {
                        addLog(`Injection failed: ${chrome.runtime.lastError.message}`);
                        setStatus('Error: Could not inject script. Try refreshing the page.');
                        setStatusType('error');
                        setIsLoading(false);
                        return;
                      }
                      addLog('Script injected, retrying...');
                      // Wait a moment then retry
                      setTimeout(sendStartMessage, 500);
                    }
                  );
                  return;
                }
                addLog(`Content script error: ${errMsg}`);
                setStatus(`Error: ${errMsg}`);
                setStatusType('error');
                setIsLoading(false);
                return;
              }
              addLog(`Started! Response: ${JSON.stringify(response)}`);
              setIsActive(true);
              setStatus('Translating... Processing first chunk');
              setStatusType('success');
              setIsLoading(false);
            }
          );
        };

        sendStartMessage();
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Connection failed';
      addLog(`Error: ${errorMsg}`);
      setStatus(`Error: ${errorMsg}`);
      setStatusType('error');
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'HERCULES_STOP' });
      }
    });

    // Cleanup session on server
    if (sessionId) {
      fetch(`${herculesState.serverUrl}/api/tts/session/${sessionId}`, {
        method: 'DELETE',
      }).catch(console.error);
    }

    setIsActive(false);
    setSessionId(null);
    setStatus('');
    setAudioReadyCount(0);
    setIsPlaying(false);
  };

  const handleVolumeChange = (volume: number) => {
    herculesStorage.setVolume(volume);
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'HERCULES_SET_VOLUME',
          volume,
        });
      }
    });
  };

  const handlePlaySynced = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'HERCULES_PLAY_SYNCED' });
        setIsPlaying(true);
        setStatus('Playing dubbed video from start...');
        setStatusType('success');
      }
    });
  };

  // Poll session status when active
  useEffect(() => {
    if (!isActive || !sessionId) return;

    const pollStatus = async () => {
      try {
        const response = await fetch(`${herculesState.serverUrl}/api/tts/session/${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          setAudioReadyCount(data.audioReadySegments || 0);
          if (data.audioReadySegments > 0 && !isPlaying) {
            setStatus(`Audio ready for ${data.audioReadySegments} segments. Click "Play Dubbed Video" to start!`);
            setStatusType('success');
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [isActive, sessionId, herculesState.serverUrl, isPlaying]);

  return (
    <div className={cn('hercules-panel', isLight ? 'bg-slate-50' : 'bg-gray-900')}>
      <header className={cn('hercules-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <div className="hercules-logo">
          <span className="hercules-icon">🦁</span>
          <h1>Hercules</h1>
        </div>
        <p className="hercules-tagline">Real-time video translation</p>
      </header>

      <main className={cn('hercules-content', isLight ? 'text-gray-800' : 'text-gray-200')}>
        {!isYouTube ? (
          <div className="hercules-notice">
            <p>Navigate to a YouTube video to start translating</p>
            <button
              onClick={() => checkCurrentTab(true)}
              className={cn(
                'hercules-btn-small',
                isLight ? 'bg-gray-200 text-gray-700' : 'bg-gray-700 text-gray-200'
              )}
              style={{ marginTop: '1rem', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
              Refresh Detection
            </button>
            {currentUrl && (
              <p style={{ fontSize: '0.7rem', marginTop: '0.5rem', opacity: 0.6, wordBreak: 'break-all' }}>
                Current: {currentUrl.substring(0, 60)}...
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="hercules-controls">
              <label className="hercules-label">
                Translate to:
                <select
                  value={herculesState.targetLanguage}
                  onChange={e => herculesStorage.setTargetLanguage(e.target.value)}
                  disabled={isActive}
                  className={cn(
                    'hercules-select',
                    isLight ? 'bg-white border-gray-300' : 'bg-gray-800 border-gray-600',
                    isActive && 'opacity-50 cursor-not-allowed'
                  )}>
                  {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="hercules-label">
                Dubbed Audio Volume: {herculesState.volume}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={herculesState.volume}
                  onChange={e => handleVolumeChange(Number(e.target.value))}
                  className="hercules-slider"
                />
              </label>
            </div>

            <div className="hercules-actions">
              {!isActive ? (
                <button
                  onClick={handleStart}
                  disabled={isLoading}
                  className={cn('hercules-btn hercules-btn-primary', isLoading && 'opacity-50')}>
                  {isLoading ? '...' : '🎬 Start Translation'}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {audioReadyCount > 0 && !isPlaying && (
                    <button onClick={handlePlaySynced} className="hercules-btn hercules-btn-primary">
                      ▶️ Play Dubbed Video
                    </button>
                  )}
                  <button onClick={handleStop} className="hercules-btn hercules-btn-danger">
                    Stop
                  </button>
                </div>
              )}
            </div>

            {currentSubtitle && isPlaying && (
              <div className="hercules-subtitle-box">
                <div className="hercules-subtitle-label">Now Playing:</div>
                <div className="hercules-subtitle-text">{currentSubtitle}</div>
              </div>
            )}

            {status && (
              <div
                className={cn(
                  'hercules-status',
                  statusType === 'error' && 'hercules-status-error',
                  statusType === 'info' && 'hercules-status-info',
                  statusType === 'success' && 'hercules-status-success'
                )}>
                {status}
              </div>
            )}

          </>
        )}
      </main>

      <footer className={cn('hercules-footer', isLight ? 'text-gray-500' : 'text-gray-400')}>
        <small>Powered by ElevenLabs</small>
      </footer>
    </div>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
