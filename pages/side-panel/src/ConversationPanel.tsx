import { useState, useRef } from 'react';
import { cn } from '@extension/ui';

interface VideoContext {
  transcript?: string;
  title?: string;
}

interface ConversationPanelProps {
  isLight: boolean;
  serverUrl: string;
  videoContext?: VideoContext;
}

interface ConversationResult {
  questionText: string;
  responseText: string;
  detectedLanguage: string;
  audioBase64: string;
}

export const ConversationPanel = ({ isLight, serverUrl, videoContext }: ConversationPanelProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('');
  const [error, setError] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

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
      setError('Microphone access needed. Click the extension icon in toolbar to allow.');
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

      if (videoContext?.transcript) {
        formData.append('videoContext', JSON.stringify(videoContext));
      }

      const response = await fetch(`${serverUrl}/api/conversation/ask`, {
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

      // Play audio response
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

  return (
    <div
      className={cn(
        'conversation-panel p-4 rounded-lg border',
        isLight ? 'bg-gray-50 border-gray-200' : 'bg-gray-800 border-gray-700',
      )}>
      <h3 className={cn('text-lg font-semibold mb-2', isLight ? 'text-gray-900' : 'text-white')}>
        🎤 Ask About This Video
      </h3>

      <p className={cn('text-sm mb-3', isLight ? 'text-gray-600' : 'text-gray-300')}>
        {videoContext?.transcript ? 'Ask questions about the video' : 'Start translation first'}
      </p>

      {/* Recording Button */}
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        {!isRecording && !isProcessing && (
          <button
            onClick={startRecording}
            disabled={!videoContext?.transcript}
            className={cn(
              'px-6 py-3 rounded-full font-medium',
              'bg-red-500 hover:bg-red-600 text-white',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}>
            🎤 Hold to Record
          </button>
        )}

        {isRecording && (
          <button
            onClick={stopRecording}
            className="px-6 py-3 rounded-full font-medium bg-red-600 hover:bg-red-700 text-white animate-pulse">
            ⏹️ Stop Recording
          </button>
        )}

        {isProcessing && <div className="text-blue-500">Processing...</div>}
      </div>

      {/* Error */}
      {error && (
        <div className="p-2 rounded bg-red-100 border border-red-300 text-red-700 text-xs mb-3">{error}</div>
      )}

      {/* Q&A Display */}
      {lastQuestion && (
        <div
          className={cn('p-3 rounded border text-sm', isLight ? 'bg-white border-gray-200' : 'bg-gray-900 border-gray-700')}>
          <div className={cn('font-medium mb-1', isLight ? 'text-gray-500' : 'text-gray-400')}>You asked:</div>
          <div className={cn('mb-3', isLight ? 'text-gray-900' : 'text-white')}>{lastQuestion}</div>
          <div className={cn('font-medium mb-1', isLight ? 'text-gray-500' : 'text-gray-400')}>Answer:</div>
          <div className={cn(isLight ? 'text-gray-900' : 'text-white')}>{lastResponse}</div>
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioPlayerRef} className="hidden" />
    </div>
  );
};
