import '@src/Popup.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, herculesStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useState, useRef, useEffect } from 'react';

interface ConversationResult {
  questionText: string;
  responseText: string;
  detectedLanguage: string;
  audioBase64: string;
}

const Popup = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const herculesState = useStorage(herculesStorage);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Get session info from storage or active tab
  useEffect(() => {
    const getSessionTranscript = async () => {
      // Try to get current session from side panel state via chrome.storage
      const result = await chrome.storage.local.get(['herculesSession']);
      if (result.herculesSession?.sessionId && result.herculesSession?.transcript) {
        setSessionId(result.herculesSession.sessionId);
        setTranscript(result.herculesSession.transcript);
      }
    };
    getSessionTranscript();
  }, []);

  const startRecording = async () => {
    try {
      setError('');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.addEventListener('dataavailable', event => {
        audioChunksRef.current.push(event.data);
      });

      mediaRecorder.addEventListener('stop', async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await sendAudioToServer(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      });

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Recording error:', err);
      setError('Microphone access denied. Please allow microphone access.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
    }
  };

  const sendAudioToServer = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      if (transcript) {
        formData.append('videoContext', JSON.stringify({ transcript }));
      }

      const response = await fetch(`${herculesState.serverUrl}/api/conversation/ask`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to process');
      }

      const result: ConversationResult = await response.json();
      setLastQuestion(result.questionText);
      setLastResponse(result.responseText);

      // Play audio
      if (result.audioBase64 && audioPlayerRef.current) {
        const audioData = atob(result.audioBase64);
        const arrayBuffer = new ArrayBuffer(audioData.length);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < audioData.length; i++) {
          view[i] = audioData.charCodeAt(i);
        }
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        audioPlayerRef.current.src = URL.createObjectURL(blob);
        audioPlayerRef.current.play();
      }
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process question');
    } finally {
      setIsProcessing(false);
    }
  };

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  };

  return (
    <div className={cn('hercules-popup', isLight ? 'bg-slate-50' : 'bg-gray-900')} style={{ width: 350, minHeight: 400 }}>
      <header className={cn('hercules-popup-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <div className="hercules-popup-logo">
          <span className="hercules-popup-icon">🦁</span>
          <h1>Hercules</h1>
        </div>
        <p className="hercules-popup-tagline">Ask About This Video</p>
      </header>

      <main className={cn('hercules-popup-content', isLight ? 'text-gray-700' : 'text-gray-300')}>
        {!transcript ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <p style={{ marginBottom: '1rem' }}>Start translation first to ask questions about the video.</p>
            <button onClick={openSidePanel} className="hercules-popup-btn hercules-popup-btn-primary">
              Open Side Panel
            </button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              {!isRecording && !isProcessing && (
                <button
                  onClick={startRecording}
                  className="hercules-popup-btn"
                  style={{ background: '#ef4444', color: 'white', padding: '1rem 2rem', borderRadius: '9999px' }}>
                  🎤 Hold to Record
                </button>
              )}

              {isRecording && (
                <button
                  onClick={stopRecording}
                  className="hercules-popup-btn"
                  style={{ background: '#dc2626', color: 'white', padding: '1rem 2rem', borderRadius: '9999px', animation: 'pulse 1s infinite' }}>
                  ⏹️ Stop Recording
                </button>
              )}

              {isProcessing && (
                <div style={{ color: '#3b82f6' }}>Processing...</div>
              )}
            </div>

            {error && (
              <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.5rem', borderRadius: '0.5rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {error}
              </div>
            )}

            {lastQuestion && (
              <div style={{ background: isLight ? '#f9fafb' : '#1f2937', padding: '0.75rem', borderRadius: '0.5rem', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem', opacity: 0.7 }}>You asked:</div>
                <div style={{ marginBottom: '0.75rem' }}>{lastQuestion}</div>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem', opacity: 0.7 }}>Answer:</div>
                <div>{lastResponse}</div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className={cn('hercules-popup-footer', isLight ? 'text-gray-500' : 'text-gray-500')}>
        <small>Powered by ElevenLabs + OpenAI</small>
      </footer>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioPlayerRef} className="hidden" />
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
