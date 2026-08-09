const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccNexusDesktop', {
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
  openProject: () => ipcRenderer.invoke('desktop:open-project'),
  getWorkspace: () => ipcRenderer.invoke('desktop:get-workspace'),
  setWorkspace: (path) => ipcRenderer.invoke('desktop:set-workspace', { path }),
  getActiveSession: () => ipcRenderer.invoke('desktop:get-active-session'),
  setActiveSession: (sessionId) => ipcRenderer.invoke('desktop:set-active-session', { sessionId }),
  listFiles: (options) => ipcRenderer.invoke('desktop:list-files', options),
  readFile: (path) => ipcRenderer.invoke('desktop:read-file', { path }),
  saveFile: (file) => ipcRenderer.invoke('desktop:save-file', file),
  scanFiles: (options) => ipcRenderer.invoke('desktop:scan-files', options),
  getProviders: () => ipcRenderer.invoke('desktop:get-providers'),
  switchProvider: (providerId) => ipcRenderer.invoke('desktop:switch-provider', { providerId }),
  getAgents: () => ipcRenderer.invoke('desktop:get-agents'),
  getAgent: (name) => ipcRenderer.invoke('desktop:get-agent', { name }),
  getMcpServers: () => ipcRenderer.invoke('desktop:get-mcp-servers'),
  getSkills: () => ipcRenderer.invoke('desktop:get-skills'),
  getCommands: () => ipcRenderer.invoke('desktop:get-commands'),
  getPrompts: () => ipcRenderer.invoke('desktop:get-prompts'),
  savePrompt: (prompt) => ipcRenderer.invoke('desktop:save-prompt', prompt),
  deletePrompt: (name) => ipcRenderer.invoke('desktop:delete-prompt', { name }),
  getSessions: () => ipcRenderer.invoke('desktop:get-sessions'),
  loadSession: (sessionId) => ipcRenderer.invoke('desktop:load-session', { sessionId }),
  loadSubagentHistory: (args) => ipcRenderer.invoke('desktop:load-subagent-history', args),
  renameSession: (sessionId, title) => ipcRenderer.invoke('desktop:rename-session', { sessionId, title }),
  toggleFavoriteSession: (sessionId) => ipcRenderer.invoke('desktop:toggle-favorite-session', { sessionId }),
  exportSession: (sessionId, title) => ipcRenderer.invoke('desktop:export-session', { sessionId, title }),
  deleteSession: (sessionId) => ipcRenderer.invoke('desktop:delete-session', { sessionId }),
  getProcesses: () => ipcRenderer.invoke('desktop:get-processes'),
  getUsageStatistics: (args) => ipcRenderer.invoke('desktop:get-usage-statistics', args),
  getContextUsage: (args) => ipcRenderer.invoke('desktop:get-context-usage', args),
  stopProcess: (processRef) => ipcRenderer.invoke('desktop:stop-process', processRef),
  restartProcess: (processRef) => ipcRenderer.invoke('desktop:restart-process', processRef),
  sendChatCommand: (message) => ipcRenderer.send('desktop:chat-command', message),
  onChatMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('desktop:chat-message', listener);
    return () => ipcRenderer.removeListener('desktop:chat-message', listener);
  },
});
