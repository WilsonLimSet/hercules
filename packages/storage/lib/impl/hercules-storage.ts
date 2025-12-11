import { createStorage, StorageEnum } from '../base/index.js';

interface DubbingJob {
  id: string;
  youtubeUrl: string;
  sourceLang: string;
  targetLang: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  error?: string;
  createdAt: number;
}

interface HerculesState {
  targetLanguage: string;
  isEnabled: boolean;
  currentJob: DubbingJob | null;
  volume: number;
  serverUrl: string;
}

const storage = createStorage<HerculesState>(
  'hercules-storage-key',
  {
    targetLanguage: 'es',
    isEnabled: false,
    currentJob: null,
    volume: 100,
    serverUrl: 'http://localhost:3001',
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const herculesStorage = {
  ...storage,
  setTargetLanguage: async (lang: string) => {
    await storage.set(state => ({ ...state, targetLanguage: lang }));
  },
  setEnabled: async (enabled: boolean) => {
    await storage.set(state => ({ ...state, isEnabled: enabled }));
  },
  setCurrentJob: async (job: DubbingJob | null) => {
    await storage.set(state => ({ ...state, currentJob: job }));
  },
  setVolume: async (volume: number) => {
    await storage.set(state => ({ ...state, volume }));
  },
  setServerUrl: async (url: string) => {
    await storage.set(state => ({ ...state, serverUrl: url }));
  },
};

export type { DubbingJob, HerculesState };
