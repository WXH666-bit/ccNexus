import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopRuntime } from './runtime/index.js';
import { createDesktopChatController } from './runtime/chatController.js';
import { createDesktopSessionController } from './runtime/sessionController.js';
import { hideDefaultApplicationMenu } from './runtime/windowMenu.js';
import { LocalConfigService } from './runtime/localConfigService.js';
import { DesktopSessionService } from './runtime/sessionService.js';
import { WorkspaceFileService } from './runtime/workspaceFiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(__dirname, 'preload.cjs');
const indexHtml = path.resolve(__dirname, '../dist/index.html');
const desktopStateFile = path.join(process.env.HOME || os.homedir() || process.cwd(), '.ccnexus', 'desktop-state.json');

const runtime = createDesktopRuntime({
  cwd: process.cwd(),
  provider: 'claude',
});
const workspaceFiles = new WorkspaceFileService({ cwd: process.cwd(), stateFile: desktopStateFile });
const localConfig = new LocalConfigService();
const desktopSessions = new DesktopSessionService({ cwd: process.cwd() });
const sessionController = createDesktopSessionController({
  runtime,
  sessions: desktopSessions,
});
const chatController = createDesktopChatController({
  runtime,
  sessions: desktopSessions,
  localConfig,
  workspaceFiles,
});

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'ccNexus',
    backgroundColor: '#1e1f22',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1f22',
      symbolColor: '#9aa0a6',
      height: 42,
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      sandbox: true,
    },
  });

  const devUrl = 'http://127.0.0.1:5000/chat';
  if (app.isPackaged) {
    mainWindow.loadFile(indexHtml, { hash: '/chat' });
  } else {
    mainWindow.loadURL(devUrl);
  }
}

async function switchWorkspace(nextPath) {
  const previousWorkspace = workspaceFiles.getWorkspace();
  const workspace = await workspaceFiles.setWorkspace(nextPath);
  if (workspace.cwd !== previousWorkspace.cwd) {
    chatController.resetForWorkspaceChange();
    runtime.setCwd(workspace.cwd);
    desktopSessions.setCwd(workspace.cwd);
  }
  return workspace;
}

ipcMain.handle('desktop:get-runtime-info', () => ({
  appName: app.name,
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  cwd: workspaceFiles.getWorkspace().cwd,
}));

ipcMain.handle('desktop:open-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开项目',
    properties: ['openDirectory'],
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  const projectPath = result.filePaths[0];
  const workspace = await switchWorkspace(projectPath);
  return { canceled: false, path: workspace.cwd, ...workspace };
});

ipcMain.handle('desktop:get-workspace', () => workspaceFiles.getWorkspace());

ipcMain.handle('desktop:get-active-session', async () => ({
  sessionId: await workspaceFiles.getActiveSessionId(),
}));

ipcMain.handle('desktop:set-active-session', async (_event, args = {}) => ({
  sessionId: await workspaceFiles.setActiveSessionId(args.sessionId ?? null),
}));

ipcMain.handle('desktop:set-workspace', async (_event, args = {}) => {
  const requestedPath = typeof args === 'string' ? args : args.path;
  return await switchWorkspace(requestedPath);
});

ipcMain.handle('desktop:list-files', async (_event, args = {}) => workspaceFiles.listTree(args));

ipcMain.handle('desktop:read-file', async (_event, args = {}) => workspaceFiles.readFile(args));

ipcMain.handle('desktop:save-file', async (_event, args = {}) => workspaceFiles.saveFile(args));

ipcMain.handle('desktop:scan-files', async (_event, args = {}) => workspaceFiles.scanFiles(args));

ipcMain.handle('desktop:get-providers', async () => localConfig.getProviders());

ipcMain.handle('desktop:switch-provider', async (event, args = {}) => {
  const before = await localConfig.getProviders();
  const result = await localConfig.switchProvider(args.providerId);
  if (before.currentProviderId !== result.provider?.id) {
    chatController.resetForProviderChange();
    if (!event.sender.isDestroyed()) {
      event.sender.send('desktop:chat-message', { type: 'status', status: 'idle' });
    }
  }
  return result;
});

ipcMain.handle('desktop:get-agents', async () => localConfig.listAgents(workspaceFiles.getWorkspace().cwd));

ipcMain.handle('desktop:get-agent', async (_event, args = {}) => localConfig.getAgent(args.name, workspaceFiles.getWorkspace().cwd));

ipcMain.handle('desktop:get-mcp-servers', async () => localConfig.listMcpServers(workspaceFiles.getWorkspace().cwd));

ipcMain.handle('desktop:get-skills', async () => localConfig.listSkills(workspaceFiles.getWorkspace().cwd));

ipcMain.handle('desktop:get-commands', async () => localConfig.listCommands());

ipcMain.handle('desktop:get-prompts', async () => localConfig.listPrompts());

ipcMain.handle('desktop:save-prompt', async (_event, args = {}) => localConfig.savePrompt(args));

ipcMain.handle('desktop:delete-prompt', async (_event, args = {}) => localConfig.deletePrompt(args.name));

ipcMain.handle('desktop:get-sessions', async () => desktopSessions.getSessions({
  protectedSessionIds: chatController.getActiveSessionIds(),
}));

ipcMain.handle('desktop:load-session', async (_event, args = {}) => sessionController.loadSession(args.sessionId));

ipcMain.handle('desktop:load-subagent-history', async (_event, args = {}) => desktopSessions.loadSubagentHistory(args));

ipcMain.handle('desktop:rename-session', async (_event, args = {}) => desktopSessions.renameSession(args.sessionId, args.title));

ipcMain.handle('desktop:toggle-favorite-session', async (_event, args = {}) => desktopSessions.toggleFavoriteSession(args.sessionId));

ipcMain.handle('desktop:export-session', async (_event, args = {}) => {
  const sessionId = args.sessionId;
  const history = await desktopSessions.loadSession(sessionId);
  const sessions = await desktopSessions.listSessions();
  const session = sessions.find((item) => item.id === sessionId) || {
    id: sessionId,
    title: `Session ${String(sessionId || '').slice(0, 8)}`,
    updatedAt: Date.now(),
  };
  const safeTitle = String(args.title || session.title || session.id || 'session')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .trim()
    .slice(0, 120) || 'session';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出会话',
    defaultPath: `${safeTitle}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify({ session, messages: history.messages || [] }, null, 2), 'utf8');
  return { canceled: false, path: result.filePath };
});

ipcMain.handle('desktop:delete-session', async (_event, args = {}) => {
  await chatController.abortSession(args.sessionId);
  return desktopSessions.deleteSession(args.sessionId);
});

ipcMain.handle('desktop:get-processes', () => runtime.buildProcessSnapshot());
ipcMain.handle('desktop:get-usage-statistics', async (_event, args = {}) => desktopSessions.getUsageStatistics(args));
ipcMain.handle('desktop:get-context-usage', async (_event, args = {}) => chatController.getContextUsage(args));

ipcMain.handle('desktop:stop-process', (_event, args = {}) => {
  const pid = Number(args.pid);
  return runtime.stopProcess({ pid, id: args.id });
});

ipcMain.handle('desktop:restart-process', (_event, args = {}) => {
  const pid = Number(args.pid);
  return runtime.restartDaemon({ pid, id: args.id });
});

ipcMain.on('desktop:chat-command', (event, message = {}) => {
  const emit = (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('desktop:chat-message', payload);
    }
  };
  void chatController.handle(message, emit);
});

app.whenReady().then(async () => {
  hideDefaultApplicationMenu(Menu);
  const workspace = await workspaceFiles.restoreWorkspace();
  runtime.setCwd(workspace.cwd);
  desktopSessions.setCwd(workspace.cwd);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  chatController.dispose();
  runtime.shutdown();
});
