import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
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
    backgroundColor: '#1f2023',
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
  const workspace = await workspaceFiles.setWorkspace(projectPath);
  runtime.setCwd(workspace.cwd);
  desktopSessions.setCwd(workspace.cwd);
  return { canceled: false, path: workspace.cwd, ...workspace };
});

ipcMain.handle('desktop:get-workspace', () => workspaceFiles.getWorkspace());

ipcMain.handle('desktop:set-workspace', async (_event, args = {}) => {
  const requestedPath = typeof args === 'string' ? args : args.path;
  const workspace = await workspaceFiles.setWorkspace(requestedPath);
  runtime.setCwd(workspace.cwd);
  desktopSessions.setCwd(workspace.cwd);
  return workspace;
});

ipcMain.handle('desktop:list-files', async (_event, args = {}) => workspaceFiles.listTree(args));

ipcMain.handle('desktop:read-file', async (_event, args = {}) => workspaceFiles.readFile(args));

ipcMain.handle('desktop:save-file', async (_event, args = {}) => workspaceFiles.saveFile(args));

ipcMain.handle('desktop:scan-files', async (_event, args = {}) => workspaceFiles.scanFiles(args));

ipcMain.handle('desktop:get-providers', async () => localConfig.getProviders());

ipcMain.handle('desktop:switch-provider', async (_event, args = {}) => localConfig.switchProvider(args.providerId));

ipcMain.handle('desktop:get-agents', async () => localConfig.listAgents());

ipcMain.handle('desktop:get-agent', async (_event, args = {}) => localConfig.getAgent(args.name));

ipcMain.handle('desktop:get-commands', async () => localConfig.listCommands());

ipcMain.handle('desktop:get-prompts', async () => localConfig.listPrompts());

ipcMain.handle('desktop:save-prompt', async (_event, args = {}) => localConfig.savePrompt(args));

ipcMain.handle('desktop:delete-prompt', async (_event, args = {}) => localConfig.deletePrompt(args.name));

ipcMain.handle('desktop:get-sessions', async () => desktopSessions.getSessions({
  protectedSessionIds: chatController.getActiveSessionIds(),
}));

ipcMain.handle('desktop:load-session', async (_event, args = {}) => sessionController.loadSession(args.sessionId));

ipcMain.handle('desktop:rename-session', async (_event, args = {}) => desktopSessions.renameSession(args.sessionId, args.title));

ipcMain.handle('desktop:delete-session', async (_event, args = {}) => desktopSessions.deleteSession(args.sessionId));

ipcMain.handle('desktop:get-processes', () => runtime.buildProcessSnapshot());

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
