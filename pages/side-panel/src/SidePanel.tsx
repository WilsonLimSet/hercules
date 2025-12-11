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
  const [jobStatus, setJobStatus] = useState<string>('');

  useEffect(() => {
    // Get current tab URL
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const url = tabs[0]?.url || '';
      setCurrentUrl(url);
      setIsYouTube(url.includes('youtube.com/watch') || url.includes('youtu.be/'));
    });

    // Listen for tab changes
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url) {
        setCurrentUrl(changeInfo.url);
        setIsYouTube(changeInfo.url.includes('youtube.com/watch') || changeInfo.url.includes('youtu.be/'));
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);
    return () => chrome.tabs.onUpdated.removeListener(handleTabUpdate);
  }, []);

  // Poll job status
  useEffect(() => {
    if (!herculesState.currentJob || herculesState.currentJob.status === 'completed') return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `${herculesState.serverUrl}/api/dubbing/status/${herculesState.currentJob?.id}`,
        );
        const job = await response.json();
        await herculesStorage.setCurrentJob(job);

        if (job.status === 'completed') {
          setJobStatus('Translation ready! Playing dubbed audio...');
          // Notify content script to play audio
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'HERCULES_PLAY_DUBBED',
                audioUrl: `${herculesState.serverUrl}${job.audioUrl}`,
                volume: herculesState.volume,
              });
            }
          });
        } else if (job.status === 'failed') {
          setJobStatus(`Translation failed: ${job.error}`);
        } else {
          setJobStatus(`Translating... (${job.status})`);
        }
      } catch (error) {
        console.error('Failed to poll job status:', error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [herculesState.currentJob, herculesState.serverUrl, herculesState.volume]);

  const handleTranslate = async () => {
    if (!isYouTube) return;

    setJobStatus('Starting translation...');

    try {
      const response = await fetch(`${herculesState.serverUrl}/api/dubbing/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: currentUrl,
          sourceLang: 'auto',
          targetLang: herculesState.targetLanguage,
        }),
      });

      const job = await response.json();

      if (job.status === 'completed') {
        setJobStatus('Using cached translation!');
        // Notify content script to play audio
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'HERCULES_PLAY_DUBBED',
              audioUrl: `${herculesState.serverUrl}${job.audioUrl}`,
              volume: herculesState.volume,
            });
          }
        });
      } else {
        await herculesStorage.setCurrentJob(job);
        setJobStatus('Translation in progress...');
      }
    } catch (error) {
      setJobStatus(`Error: ${error instanceof Error ? error.message : 'Connection failed'}`);
    }
  };

  const handleStop = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'HERCULES_STOP' });
      }
    });
    herculesStorage.setCurrentJob(null);
    setJobStatus('');
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
                  className={cn('hercules-select', isLight ? 'bg-white border-gray-300' : 'bg-gray-800 border-gray-600')}>
                  {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="hercules-label">
                Volume: {herculesState.volume}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={herculesState.volume}
                  onChange={e => herculesStorage.setVolume(Number(e.target.value))}
                  className="hercules-slider"
                />
              </label>
            </div>

            <div className="hercules-actions">
              {!herculesState.currentJob ||
              herculesState.currentJob.status === 'completed' ||
              herculesState.currentJob.status === 'failed' ? (
                <button onClick={handleTranslate} className="hercules-btn hercules-btn-primary">
                  🎬 Translate Video
                </button>
              ) : (
                <button onClick={handleStop} className="hercules-btn hercules-btn-danger">
                  ⏹️ Stop
                </button>
              )}
            </div>

            {jobStatus && (
              <div
                className={cn(
                  'hercules-status',
                  herculesState.currentJob?.status === 'failed' ? 'hercules-status-error' : 'hercules-status-info',
                )}>
                {jobStatus}
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
