import { useState, useRef } from 'react';
import { cn } from '@extension/ui';

interface ConversationPanelProps {
  isLight: boolean;
}

interface ConversationResult {
  questionText: string;
  responseText: string;
  detectedLanguage: string;
  audioBase64: string;
}

const API_URL = 'http://localhost:3001';

export const ConversationPanel = ({ isLight }: ConversationPanelProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('');
  const [detectedLanguage, setDetectedLanguage] = useState<string>('');
  const [error, setError] = useState<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
    try {
      setError('');
      
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support audio recording. Please use a modern browser like Chrome or Edge.');
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.addEventListener('dataavailable', event => {
        audioChunksRef.current.push(event.data);
      });

      mediaRecorder.addEventListener('stop', async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await sendAudioToServer(audioBlob);
        
        // Stop all tracks to turn off microphone
        stream.getTracks().forEach(track => track.stop());
      });

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error('Error starting recording:', err);
      
      let errorMessage = 'Failed to access microphone. ';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += 'Please allow microphone access:\n1. Click the 🔒 lock icon in the address bar\n2. Allow microphone permissions\n3. Refresh this page';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No microphone found. Please connect a microphone and try again.';
      } else if (err.message) {
        errorMessage += err.message;
      } else {
        errorMessage += 'Please check your browser permissions and try again.';
      }
      
      setError(errorMessage);
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

      const response = await fetch(`${API_URL}/api/conversation/ask`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to process audio');
      }

      const result: ConversationResult = await response.json();
      
      setLastQuestion(result.questionText);
      setLastResponse(result.responseText);
      setDetectedLanguage(result.detectedLanguage);

      // Play the response audio
      playResponseAudio(result.audioBase64);
      
    } catch (err) {
      console.error('Error sending audio:', err);
      setError('Failed to process your question. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const playResponseAudio = (audioBase64: string) => {
    try {
      // Convert base64 to blob
      const audioData = atob(audioBase64);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);
      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);

      // Play audio
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = audioUrl;
        audioPlayerRef.current.play();
      }
    } catch (err) {
      console.error('Error playing audio:', err);
      setError('Failed to play audio response');
    }
  };

  return (
    <div className={cn(
      'conversation-panel p-4 rounded-lg border',
      isLight ? 'bg-gray-50 border-gray-200' : 'bg-gray-800 border-gray-700'
    )}>
      <h3 className={cn(
        'text-lg font-semibold mb-3',
        isLight ? 'text-gray-900' : 'text-white'
      )}>
        🎤 Ask AI Anything
      </h3>

      <p className={cn(
        'text-sm mb-4',
        isLight ? 'text-gray-600' : 'text-gray-300'
      )}>
        Ask a question in any language and get an AI response in the same language.
      </p>

      {/* Recording Button */}
      <div className="flex flex-col items-center gap-3 mb-4">
        {!isRecording && !isProcessing && (
          <button
            onClick={startRecording}
            className={cn(
              'px-6 py-3 rounded-full font-medium transition-all',
              'bg-red-500 hover:bg-red-600 text-white',
              'flex items-center gap-2'
            )}>
            <span className="text-xl">🎤</span>
            Hold to Record
          </button>
        )}

        {isRecording && (
          <button
            onClick={stopRecording}
            className={cn(
              'px-6 py-3 rounded-full font-medium transition-all',
              'bg-red-600 hover:bg-red-700 text-white animate-pulse',
              'flex items-center gap-2'
            )}>
            <span className="text-xl">⏹️</span>
            Stop Recording
          </button>
        )}

        {isProcessing && (
          <div className="flex items-center gap-2 text-blue-500">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
            <span>Processing...</span>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 rounded bg-red-100 border border-red-300 text-red-700 text-sm mb-4 whitespace-pre-line">
          {error}
        </div>
      )}

      {/* Helpful Tips */}
      {!lastQuestion && !isRecording && !isProcessing && (
        <div className={cn(
          'text-xs p-3 rounded border mb-4',
          isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-900 border-blue-700 text-blue-200'
        )}>
          <strong>💡 Tips:</strong>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Allow microphone access when prompted</li>
            <li>Speak clearly and naturally</li>
            <li>Works in any language!</li>
          </ul>
        </div>
      )}

      {/* Conversation History */}
      {lastQuestion && (
        <div className={cn(
          'space-y-3 p-3 rounded border',
          isLight ? 'bg-white border-gray-200' : 'bg-gray-900 border-gray-700'
        )}>
          <div>
            <div className={cn(
              'text-xs font-medium mb-1',
              isLight ? 'text-gray-500' : 'text-gray-400'
            )}>
              Your Question ({detectedLanguage}):
            </div>
            <div className={cn(
              'text-sm',
              isLight ? 'text-gray-900' : 'text-white'
            )}>
              {lastQuestion}
            </div>
          </div>

          <div className="border-t border-gray-300 dark:border-gray-600 pt-3">
            <div className={cn(
              'text-xs font-medium mb-1',
              isLight ? 'text-gray-500' : 'text-gray-400'
            )}>
              AI Response:
            </div>
            <div className={cn(
              'text-sm',
              isLight ? 'text-gray-900' : 'text-white'
            )}>
              {lastResponse}
            </div>
          </div>
        </div>
      )}

      {/* Hidden audio player */}
      <audio ref={audioPlayerRef} className="hidden" />
    </div>
  );
};

