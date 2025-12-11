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
  const [isActive, setIsActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Get current tab URL
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const url = tabs[0]?.url || '';
      setCurrentUrl(url);
      setIsYouTube(url.includes('youtube.com/watch') || url.includes('youtu.be/'));
    });

    // Listen for tab changes
    const handleTabUpdate = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url) {
        setCurrentUrl(changeInfo.url);
        setIsYouTube(changeInfo.url.includes('youtube.com/watch') || changeInfo.url.includes('youtu.be/'));
        // Reset state on navigation
        setIsActive(false);
        setSessionId(null);
        setStatus('');
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    // Listen for stop message from content script
    const handleMessage = (message: { type: string }) => {
      if (message.type === 'HERCULES_STOPPED') {
        setIsActive(false);
        setSessionId(null);
        setStatus('');
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleStart = async () => {
    if (!isYouTube) return;

    setStatus('Creating session...');

    try {
      // Create session on server
      const response = await fetch(`${herculesState.serverUrl}/api/dubbing/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: currentUrl,
          targetLang: herculesState.targetLanguage,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const { sessionId: newSessionId } = await response.json();
      setSessionId(newSessionId);

      // Start translation in content script
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'HERCULES_START',
            sessionId: newSessionId,
            serverUrl: herculesState.serverUrl,
            targetLang: herculesState.targetLanguage,
            volume: herculesState.volume,
          });
        }
      });

      setIsActive(true);
      setStatus('Translating...');
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Connection failed'}`);
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
      fetch(`${herculesState.serverUrl}/api/dubbing/session/${sessionId}`, {
        method: 'DELETE',
      }).catch(console.error);
    }

    setIsActive(false);
    setSessionId(null);
    setStatus('');
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

            <div className="hercules-info">
              <p>
                <strong>How it works:</strong>
              </p>
              <ol>
                <li>Click "Start Translation"</li>
                <li>Original audio will be lowered</li>
                <li>Dubbed audio plays over the video</li>
                <li>Each 30s chunk is processed</li>
              </ol>
            </div>

            <div className="hercules-actions">
              {!isActive ? (
                <button onClick={handleStart} className="hercules-btn hercules-btn-primary">
                  🎬 Start Translation
                </button>
              ) : (
                <button onClick={handleStop} className="hercules-btn hercules-btn-danger">
                  ⏹️ Stop
                </button>
              )}
            </div>

            {status && (
              <div className={cn('hercules-status', 'hercules-status-info')}>
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
