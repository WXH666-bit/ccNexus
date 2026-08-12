import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WorkspaceFileService } from '../desktop/runtime/workspaceFiles.js';

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
  assert.match(main, /ipcMain\.handle\('desktop:get-active-session'/);
  assert.match(main, /ipcMain\.handle\('desktop:set-active-session'/);
  assert.match(main, /properties:\s*\[\s*'openDirectory'/);
  assert.match(preload, /openProject:\s*\(\) => ipcRenderer\.invoke\('desktop:open-project'\)/);
  assert.match(preload, /listFiles:/);
  assert.match(preload, /readFile:/);
  assert.match(preload, /saveFile:/);
  assert.match(preload, /setWorkspace:/);
  assert.match(preload, /getActiveSession:/);
  assert.match(preload, /setActiveSession:/);
});

test('file explorer can open a desktop-selected project and refresh the tree', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /desktopApi\.openProject/);
  assert.doesNotMatch(source, /desktopApi\.setWorkspace/);
  assert.match(source, /void loadTree\(\)/);
  assert.match(source, /FolderPlus/);
});

test('chat header exposes a top-level desktop open project action', () => {
  const header = read('src/components/ChatHeader.tsx');
  const chat = read('src/views/ChatView.tsx');

  assert.match(header, /FolderPlus/);
  assert.match(header, /onOpenProject/);
  assert.match(chat, /handleOpenProject/);
  assert.match(chat, /desktopApi\.openProject/);
  assert.match(chat, /handleWorkspaceChanged/);
  assert.doesNotMatch(chat, /setWorkspace\(project\.path\)/);
  assert.match(chat, /<FileExplorer key=\{workspaceVersion\} onWorkspaceChange=\{handleWorkspaceChanged\}/);
  assert.match(chat, /onOpenProject=\{handleOpenProject\}/);
});

test('file explorer uses desktop file IPC without a browser fallback', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /desktopApi\.listFiles/);
  assert.match(source, /desktopApi\.readFile/);
  assert.match(source, /desktopApi\.saveFile/);
  assert.doesNotMatch(source, /fetch\(/);
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

test('desktop workspace service restores the last opened workspace after restart', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-workspace-'));
  try {
    const defaultDir = path.join(tempRoot, 'default');
    const projectDir = path.join(tempRoot, 'project');
    const stateFile = path.join(tempRoot, 'state', 'desktop-state.json');
    await mkdir(defaultDir);
    await mkdir(projectDir);

    const firstRun = new WorkspaceFileService({ cwd: defaultDir, stateFile });
    await firstRun.setWorkspace(projectDir);

    const restarted = new WorkspaceFileService({ cwd: defaultDir, stateFile });
    await restarted.restoreWorkspace();

    assert.equal(restarted.getWorkspace().cwd, path.resolve(projectDir));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('desktop workspace service restores the last active session per workspace', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-active-session-'));
  try {
    const workspaceA = path.join(tempRoot, 'workspace-a');
    const workspaceB = path.join(tempRoot, 'workspace-b');
    const stateFile = path.join(tempRoot, 'state', 'desktop-state.json');
    await mkdir(workspaceA);
    await mkdir(workspaceB);

    const firstRun = new WorkspaceFileService({ cwd: workspaceA, stateFile });
    await firstRun.setActiveSessionId('session-a');
    await firstRun.setWorkspace(workspaceB);
    await firstRun.setActiveSessionId('session-b');

    const restarted = new WorkspaceFileService({ cwd: workspaceA, stateFile });
    assert.equal(await restarted.getActiveSessionId(), 'session-a');
    await restarted.setWorkspace(workspaceB);
    assert.equal(await restarted.getActiveSessionId(), 'session-b');
    await restarted.setWorkspace(workspaceA);
    assert.equal(await restarted.getActiveSessionId(), 'session-a');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('desktop workspace service rejects symlink targets outside the workspace', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-workspace-symlink-'));
  try {
    const workspace = path.join(tempRoot, 'workspace');
    const outside = path.join(tempRoot, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'private', 'utf8');

    try {
      await symlink(outside, path.join(workspace, 'linked'), 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('directory junctions are unavailable in this environment');
        return;
      }
      throw error;
    }

    const service = new WorkspaceFileService({ cwd: workspace });
    await assert.rejects(() => service.readFile('linked/secret.txt'), /Access denied/);
    await assert.rejects(() => service.listTree({ path: 'linked' }), /Access denied/);
    await assert.rejects(
      () => service.saveFile({ path: 'linked/secret.txt', content: 'changed' }),
      /Access denied/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('desktop main keeps the workspace root in the Electron host', () => {
  const main = read('desktop/main.js');

  assert.match(main, /workspaceFiles\.setWorkspace/);
  assert.match(main, /runtime\.setCwd\(workspace\.cwd\)/);
  assert.match(main, /desktopSessions\.setCwd\(workspace\.cwd\)/);
  assert.match(main, /workspaceFiles\.restoreWorkspace/);
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
