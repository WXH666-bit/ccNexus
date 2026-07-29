import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('desktop main exposes an open project dialog through IPC', () => {
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');

  assert.match(main, /WorkspaceFileService/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /ipcMain\.handle\('desktop:open-project'/);
  assert.match(main, /ipcMain\.handle\('desktop:list-files'/);
  assert.match(main, /ipcMain\.handle\('desktop:read-file'/);
  assert.match(main, /ipcMain\.handle\('desktop:save-file'/);
  assert.match(main, /ipcMain\.handle\('desktop:set-workspace'/);
  assert.match(main, /properties:\s*\[\s*'openDirectory'/);
  assert.match(preload, /openProject:\s*\(\) => ipcRenderer\.invoke\('desktop:open-project'\)/);
  assert.match(preload, /listFiles:/);
  assert.match(preload, /readFile:/);
  assert.match(preload, /saveFile:/);
  assert.match(preload, /setWorkspace:/);
});

test('file explorer can open a desktop-selected project and refresh the tree', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /window\.ccNexusDesktop\?\.openProject/);
  assert.match(source, /window\.ccNexusDesktop\?\.setWorkspace/);
  assert.match(source, /void loadTree\(\)/);
  assert.match(source, /FolderPlus/);
});

test('chat header exposes a top-level desktop open project action', () => {
  const header = read('src/components/ChatHeader.tsx');
  const chat = read('src/views/ChatView.tsx');

  assert.match(header, /FolderPlus/);
  assert.match(header, /onOpenProject/);
  assert.match(chat, /handleOpenProject/);
  assert.match(chat, /window\.ccNexusDesktop\?\.openProject/);
  assert.match(chat, /setWorkspace\(project\.path\)/);
  assert.match(chat, /<FileExplorer key=\{workspaceVersion\}/);
  assert.match(chat, /onOpenProject=\{window\.ccNexusDesktop\?\.openProject \? handleOpenProject : undefined\}/);
});

test('file explorer uses desktop file IPC first and keeps fetch as browser fallback', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /window\.ccNexusDesktop\?\.listFiles/);
  assert.match(source, /window\.ccNexusDesktop\?\.readFile/);
  assert.match(source, /window\.ccNexusDesktop\?\.saveFile/);
  assert.match(source, /fetch\('\/api\/files\/tree/);
  assert.match(source, /fetch\('\/api\/files\/content'/);
});

test('desktop workspace file service mirrors server file safety rules', () => {
  const service = read('desktop/runtime/workspaceFiles.js');

  assert.match(service, /class WorkspaceFileService/);
  assert.match(service, /safePath\(requestedPath/);
  assert.match(service, /isProtectedWorkspacePath/);
  assert.match(service, /segments\.includes\('\.claude'\)/);
  assert.match(service, /BINARY_EXTS\.has\(ext\)/);
  assert.match(service, /async listTree/);
  assert.match(service, /async readFile/);
  assert.match(service, /async saveFile/);
  assert.match(service, /async setWorkspace/);
});

test('server keeps a mutable workspace root for file APIs and Claude queries', () => {
  const server = read('server/index.js');

  assert.match(server, /let workspaceRoot = process\.cwd\(\)/);
  assert.match(server, /function currentClaudeProjectSessionsDir\(\)/);
  assert.match(server, /app\.get\('\/api\/workspace'/);
  assert.match(server, /app\.post\('\/api\/workspace'/);
  assert.match(server, /setWorkspaceRoot/);
  assert.match(server, /desktopRuntime\.setCwd\(workspaceRoot\)/);
  assert.match(server, /cwd:\s*workspaceRoot/);
  assert.doesNotMatch(server, /const CWD = process\.cwd\(\)/);
});

test('desktop runtime can switch cwd and retire old daemons before new work starts', () => {
  const runtime = read('desktop/runtime/index.js');
  const registry = read('desktop/runtime/processRegistry.js');

  assert.match(runtime, /function setCwd\(nextCwd\)/);
  assert.match(runtime, /shutdown\(\)/);
  assert.match(runtime, /runtimeCwd = nextCwd/);
  assert.match(registry, /setCwd\(nextCwd\)/);
  assert.match(registry, /this\.cwd = nextCwd/);
});
