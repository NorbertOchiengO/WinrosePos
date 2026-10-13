/// <reference types="vite/client" />

export type LocalConfig = {
  mode: string;
  serverIp: string;
  till: number;
  apiPort: number;
};

export type ApiInfo = {
  baseUrl: string;
  healthUrl: string;
  mode: string;
  serverIp: string;
  till: number;
  lanIp: string;
  localServerRunning: boolean;
};

export type PosBridge = {
  getPaths: () => Promise<{ uploads: string; userData: string }>;
  getLocalConfig: () => Promise<LocalConfig>;
  setLocalConfig: (config: Partial<LocalConfig>) => Promise<LocalConfig>;
  getLanIp: () => Promise<string>;
  getApiInfo: () => Promise<ApiInfo>;
  quit: () => void;
  reload: () => void;
  /** Electron only: live sync-engine status. Absent in the plain-browser fallback. */
  getSyncStatus?: () => Promise<{
    enabled: boolean;
    online: boolean;
    syncing: boolean;
    pendingCount: number;
    lastResult: { at?: string } | null;
    lastError: string | null;
  }>;
};

declare global {
  interface Window {
    pos: PosBridge;
  }
}

export {};
