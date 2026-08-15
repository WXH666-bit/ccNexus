/// <reference types="vite/client" />

type AppUpdateStatus = 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'error';

interface AppearanceBackgroundPreferences {
  opacity: number;
  blur: number;
  overlay: number;
  hasImage: boolean;
  imageMime: string | null;
  imageDataUrl: string | null;
}

interface AppearancePreferences {
  theme: 'dark' | 'light';
  background: AppearanceBackgroundPreferences;
}

interface AppUpdateState {
  status: AppUpdateStatus;
  isPackaged: boolean;
  currentVersion: string;
  targetVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
  error: string | null;
  lastCheckedAt: number | null;
}

interface PromptEnhancementArgs {
  requestId: string;
  text: string;
  localResult: unknown;
}

interface PromptEnhancementUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

interface PromptEnhancementResult {
  requestId: string;
  text: string;
  model: string;
  usage: PromptEnhancementUsage | undefined;
}

interface PromptEnhancementCancelResult {
  cancelled: boolean;
  requestId: string;
}

interface CcNexusDesktopApi {
  getRuntimeInfo: () => Promise<{
    appName: string;
    appVersion: string;
    isPackaged: boolean;
    cwd: string;
  }>;
  getUpdateState: () => Promise<AppUpdateState>;
  checkForUpdates: () => Promise<AppUpdateState>;
  downloadUpdate: () => Promise<AppUpdateState>;
  installUpdate: () => Promise<AppUpdateState>;
  getWindowPreferences: () => Promise<{
    closeBehavior: 'minimize-to-tray' | 'exit';
  }>;
  setWindowPreferences: (preferences: {
    closeBehavior: 'minimize-to-tray' | 'exit';
  }) => Promise<{
    closeBehavior: 'minimize-to-tray' | 'exit';
  }>;
  getAppearancePreferences: () => Promise<AppearancePreferences>;
  setTheme: (theme: 'dark' | 'light') => Promise<AppearancePreferences>;
  saveAppearancePreferences: (preferences: Partial<Omit<AppearancePreferences, 'background'>> & {
    background?: Partial<AppearanceBackgroundPreferences>;
  }) => Promise<AppearancePreferences>;
  chooseAppearanceBackground: () => Promise<{
    canceled: boolean;
    preferences: AppearancePreferences;
    error?: string;
  }>;
  clearAppearanceBackground: () => Promise<AppearancePreferences>;
  onUpdateStatus: (callback: (state: AppUpdateState) => void) => () => void;
  openProject: () => Promise<{ canceled: boolean; path?: string; cwd?: string; rootName?: string }>;
  getWorkspace: () => Promise<{ cwd: string; rootName: string }>;
  setWorkspace: (path: string) => Promise<{ cwd: string; rootName: string }>;
  getActiveSession: () => Promise<{ sessionId: string | null }>;
  setActiveSession: (sessionId: string | null) => Promise<{ sessionId: string | null }>;
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
  getPathForFile: (file: File) => string;
  scanFiles: (options?: { q?: string; limit?: number }) => Promise<{ files: string[] }>;
  getProviders: () => Promise<{
    providers: Array<{
      id: string;
      name: string;
      isActive?: boolean;
      isLocalProvider?: boolean;
      isCliLoginProvider?: boolean;
      [key: string]: unknown;
    }>;
    currentProviderId?: string | null;
    currentEnv?: Record<string, string | undefined>;
    providerMode?: string | null;
  }>;
  switchProvider: (providerId: string) => Promise<{
    ok: boolean;
    changed?: boolean;
    previousProviderId?: string | null;
    provider?: { id: string; name: string; [key: string]: unknown };
    providerMode?: string;
  }>;
  getAgents: () => Promise<{ agents: unknown[]; selectedAgentId?: string | null }>;
  getAgent: (name: string) => Promise<unknown>;
  saveAgent: (agent: { id?: string; name: string; prompt: string; description?: string }) => Promise<unknown>;
  deleteAgent: (id: string) => Promise<unknown>;
  setSelectedAgent: (id: string | null) => Promise<unknown>;
  exportAgents: () => Promise<unknown>;
  importAgents: (payload: { agents: unknown[] | Record<string, unknown>; strategy: 'skip' | 'overwrite' | 'duplicate' }) => Promise<unknown>;
  getMcpServers: () => Promise<unknown>;
  saveMcpServer: (server: { id: string; config: Record<string, unknown>; scope: 'global' | 'project' }) => Promise<unknown>;
  deleteMcpServer: (server: { id: string; scope: 'global' | 'project' }) => Promise<unknown>;
  toggleMcpServer: (server: { id: string; scope: 'global' | 'project'; enabled: boolean }) => Promise<unknown>;
  getMcpStatus: () => Promise<unknown>;
  getMcpTools: (server: { id: string; scope?: 'global' | 'project' }) => Promise<unknown>;
  getMcpServerForEdit: (server: { id: string; scope: 'global' | 'project' }) => Promise<unknown>;
  getSkills: () => Promise<unknown>;
  importSkills: (scope: 'global' | 'local') => Promise<unknown>;
  deleteSkill: (skill: { name: string; scope: 'global' | 'local'; enabled: boolean }) => Promise<unknown>;
  toggleSkill: (skill: { name: string; scope: 'global' | 'local'; enabled: boolean }) => Promise<unknown>;
  openSkill: (skill: { path: string }) => Promise<unknown>;
  getCommands: () => Promise<{ commands: unknown[] }>;
  getPrompts: () => Promise<{ prompts: unknown[] }>;
  savePrompt: (prompt: { name: string; content: string }) => Promise<unknown>;
  deletePrompt: (name: string) => Promise<unknown>;
  getSessions: () => Promise<{ type: 'session_list'; sessions: unknown[]; deletedSessionIds?: string[] }>;
  loadSession: (sessionId: string) => Promise<{ type: 'session_history'; sessionId: string; messages: unknown[] }>;
  loadSubagentHistory: (args: { sessionId: string; agentId?: string; description?: string; toolUseId?: string }) => Promise<{
    success: boolean;
    toolUseId?: string;
    agentId?: string;
    sessionId?: string;
    error?: string;
    messages?: unknown[];
  }>;
  renameSession: (sessionId: string, title: string) => Promise<{ type: 'session_renamed'; session_id: string; title: string }>;
  toggleFavoriteSession: (sessionId: string) => Promise<{ type: 'session_favorite_changed'; sessionId: string; isFavorite: boolean; favoritedAt?: number }>;
  exportSession: (sessionId: string, title?: string) => Promise<{ canceled: boolean; path?: string }>;
  deleteSession: (sessionId: string) => Promise<{ type: 'session_deleted'; sessionId: string }>;
  getProcesses: () => Promise<unknown>;
  getUsageStatistics: (args?: { scope?: 'current' | 'all'; dateRange?: 'today' | '7d' | '30d' | 'all' }) => Promise<unknown>;
  getContextUsage: (args?: {
    sessionId?: string | null;
    model?: string;
    mode?: 'default' | 'plan' | 'acceptEdits' | 'auto' | 'bypassPermissions';
    reasoning?: string;
    agent?: string;
    streaming?: boolean;
    alwaysThinking?: boolean;
  }) => Promise<unknown>;
  enhancePrompt: (args: PromptEnhancementArgs) => Promise<PromptEnhancementResult>;
  cancelPromptEnhancement: (requestId: string) => Promise<PromptEnhancementCancelResult>;
  stopProcess: (processRef: { pid: number; id?: string }) => Promise<unknown>;
  restartProcess: (processRef: { pid: number; id?: string }) => Promise<unknown>;
  sendChatCommand: (message: Record<string, unknown>) => void;
  onChatMessage: (callback: (message: unknown) => void) => () => void;
}

interface Window {
  ccNexusDesktop?: CcNexusDesktopApi;
}
