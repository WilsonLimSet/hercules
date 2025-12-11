import '@src/Popup.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';

const Popup = () => {
  const { isLight } = useStorage(exampleThemeStorage);

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  };

  const goToYouTube = () => {
    chrome.tabs.create({ url: 'https://youtube.com' });
  };

  return (
    <div className={cn('hercules-popup', isLight ? 'bg-slate-50' : 'bg-gray-900')}>
      <header className={cn('hercules-popup-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <div className="hercules-popup-logo">
          <span className="hercules-popup-icon">🦁</span>
          <h1>Hercules</h1>
        </div>
        <p className="hercules-popup-tagline">Real-time YouTube Translation</p>
      </header>

      <main className={cn('hercules-popup-content', isLight ? 'text-gray-700' : 'text-gray-300')}>
        <p>Translate any YouTube video to 20+ languages using AI dubbing.</p>

        <div className="hercules-popup-actions">
          <button
            onClick={openSidePanel}
            className={cn(
              'hercules-popup-btn hercules-popup-btn-primary',
            )}>
            Open Side Panel
          </button>

          <button
            onClick={goToYouTube}
            className={cn(
              'hercules-popup-btn',
              isLight ? 'bg-gray-200 text-gray-800' : 'bg-gray-700 text-gray-200',
            )}>
            Go to YouTube
          </button>
        </div>
      </main>

      <footer className={cn('hercules-popup-footer', isLight ? 'text-gray-500' : 'text-gray-500')}>
        <small>Powered by ElevenLabs</small>
      </footer>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
