import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, herculesStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useState, useEffect } from 'react';

const CHUNK_DURATION = 30;

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

interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
}

interface JobWithChunks {
  id: string;
  chunks: ChunkInfo[];
  currentChunk: number;
  totalChunks: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

const SidePanel = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const herculesState = useStorage(herculesStorage);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isYouTube, setIsYouTube] = useState(false);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [currentJob, setCurrentJob] = useState<JobWithChunks | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

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
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);
    return () => chrome.tabs.onUpdated.removeListener(handleTabUpdate);
  }, []);

  // Poll job status
  useEffect(() => {
    if (!currentJob || currentJob.status === 'completed' || currentJob.status === 'failed') return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${herculesState.serverUrl}/api/dubbing/status/${currentJob.id}`);
        const job: JobWithChunks = await response.json();
        setCurrentJob(job);

        const completedChunks = job.chunks.filter(c => c.status === 'completed').length;
        const processingChunk = job.chunks.find(c => c.status === 'processing');

        if (completedChunks > 0) {
          // Notify content script about available chunks
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'HERCULES_UPDATE_CHUNKS',
                chunks: job.chunks,
              });
            }
          });
        }

        if (processingChunk) {
          setJobStatus(`Processing chunk ${processingChunk.index + 1}/${job.totalChunks}...`);
        } else if (completedChunks === job.totalChunks) {
          setJobStatus('All chunks ready!');
          setIsTranslating(false);
        } else {
          setJobStatus(`${completedChunks}/${job.totalChunks} chunks ready`);
        }

        // Start playback as soon as first chunk is ready
        if (completedChunks >= 1 && !isTranslating) {
          const firstCompletedChunk = job.chunks.find(c => c.status === 'completed');
          if (firstCompletedChunk) {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
              if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                  type: 'HERCULES_START_CHUNKS',
                  jobId: job.id,
                  chunks: job.chunks,
                  serverUrl: herculesState.serverUrl,
                  volume: herculesState.volume,
                  targetLang: herculesState.targetLanguage,
                });
              }
            });
            setIsTranslating(true);
          }
        }
      } catch (error) {
        console.error('Failed to poll job status:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [currentJob, herculesState.serverUrl, herculesState.volume, herculesState.targetLanguage, isTranslating]);

  const getVideoDuration = (): Promise<number> => {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]?.id) {
          chrome.scripting.executeScript(
            {
              target: { tabId: tabs[0].id },
              func: () => {
                const video = document.querySelector('video.html5-main-video') as HTMLVideoElement;
                return video?.duration || 0;
              },
            },
            results => {
              resolve(results?.[0]?.result || 300); // Default to 5 minutes if can't get duration
            }
          );
        } else {
          resolve(300);
        }
      });
    });
  };

  const handleTranslate = async () => {
    if (!isYouTube) return;

    setJobStatus('Getting video duration...');

    try {
      const videoDuration = await getVideoDuration();
      const totalChunks = Math.ceil(videoDuration / CHUNK_DURATION);

      setJobStatus(`Starting translation (${totalChunks} chunks)...`);

      const response = await fetch(`${herculesState.serverUrl}/api/dubbing/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: currentUrl,
          sourceLang: 'auto',
          targetLang: herculesState.targetLanguage,
          videoDuration,
        }),
      });

      const job: JobWithChunks = await response.json();
      setCurrentJob(job);
      setJobStatus(`Processing chunk 1/${job.totalChunks}...`);
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
    setCurrentJob(null);
    setIsTranslating(false);
    setJobStatus('');
  };

  const completedChunks = currentJob?.chunks.filter(c => c.status === 'completed').length || 0;
  const totalChunks = currentJob?.totalChunks || 0;
  const progress = totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 0;

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
                  disabled={!!currentJob}
                  className={cn(
                    'hercules-select',
                    isLight ? 'bg-white border-gray-300' : 'bg-gray-800 border-gray-600',
                    currentJob && 'opacity-50 cursor-not-allowed'
                  )}>
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
                  onChange={e => {
                    herculesStorage.setVolume(Number(e.target.value));
                    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                      if (tabs[0]?.id) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                          type: 'HERCULES_SET_VOLUME',
                          volume: Number(e.target.value),
                        });
                      }
                    });
                  }}
                  className="hercules-slider"
                />
              </label>
            </div>

            {currentJob && (
              <div className="hercules-progress">
                <div className="hercules-progress-bar">
                  <div
                    className="hercules-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="hercules-progress-text">
                  {completedChunks}/{totalChunks} chunks ({Math.round(progress)}%)
                </div>
                <div className="hercules-chunks">
                  {currentJob.chunks.map(chunk => (
                    <div
                      key={chunk.index}
                      className={cn(
                        'hercules-chunk',
                        chunk.status === 'completed' && 'hercules-chunk-completed',
                        chunk.status === 'processing' && 'hercules-chunk-processing',
                        chunk.status === 'failed' && 'hercules-chunk-failed'
                      )}
                      title={`Chunk ${chunk.index + 1}: ${chunk.status}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="hercules-actions">
              {!currentJob ? (
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
                  currentJob?.status === 'failed' ? 'hercules-status-error' : 'hercules-status-info'
                )}>
                {jobStatus}
              </div>
            )}
          </>
        )}
      </main>

      <footer className={cn('hercules-footer', isLight ? 'text-gray-500' : 'text-gray-400')}>
        <small>Powered by ElevenLabs • 30s chunks</small>
      </footer>
    </div>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
