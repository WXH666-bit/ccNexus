/// <reference types="vite/client" />

interface CcNexusDesktopApi {
  getRuntimeInfo: () => Promise<{
    appName: string;
    appVersion: string;
    isPackaged: boolean;
    cwd: string;
  }>;
  openProject: () => Promise<{ canceled: boolean; path?: string; cwd?: string; rootName?: string }>;
  getWorkspace: () => Promise<{ cwd: string; rootName: string }>;
  setWorkspace: (path: string) => Promise<{ cwd: string; rootName: string }>;
  listFiles: (options?: {
    path?: string;
    depth?: number;
    showDotfiles?: boolean;
    maxItems?: number;
  }) => Promise<{
    tree: Array<{
      name: string;
      path: string;
      isDirectory: boolean;
      children?: unknown[];
    }>;
    root: string;
    cwd: string;
    rootName: string;
  }>;
  readFile: (path: string) => Promise<{
    content: string | null;
    isImage?: boolean;
    isBinary?: boolean;
    mimeType?: string;
    path: string;
    size: number;
  }>;
  saveFile: (file: { path: string; content: string }) => Promise<{
    ok: boolean;
    path: string;
    size: number;
    mtimeMs: number;
  }>;
  scanFiles: (options?: { q?: string; limit?: number }) => Promise<{ files: string[] }>;
  getProviders: () => Promise<{
    providers: unknown[];
    currentProviderId?: string | null;
    currentEnv?: Record<string, string | undefined>;
  }>;
  switchProvider: (providerId: string) => Promise<unknown>;
  getAgents: () => Promise<{ agents: unknown[] }>;
  getAgent: (name: string) => Promise<unknown>;
  getCommands: () => Promise<{ commands: unknown[] }>;
  getPrompts: () => Promise<{ prompts: unknown[] }>;
  savePrompt: (prompt: { name: string; content: string }) => Promise<unknown>;
  deletePrompt: (name: string) => Promise<unknown>;
  getSessions: () => Promise<{ type: 'session_list'; sessions: unknown[]; deletedSessionIds?: string[] }>;
  loadSession: (sessionId: string) => Promise<{ type: 'session_history'; sessionId: string; messages: unknown[] }>;
  renameSession: (sessionId: string, title: string) => Promise<{ type: 'session_renamed'; session_id: string; title: string }>;
  deleteSession: (sessionId: string) => Promise<{ type: 'session_deleted'; sessionId: string }>;
  getProcesses: () => Promise<unknown>;
  stopProcess: (processRef: { pid: number; id?: string }) => Promise<unknown>;
  restartProcess: (processRef: { pid: number; id?: string }) => Promise<unknown>;
  sendChatCommand: (message: Record<string, unknown>) => void;
  onChatMessage: (callback: (message: unknown) => void) => () => void;
}

interface Window {
  ccNexusDesktop?: CcNexusDesktopApi;
}
