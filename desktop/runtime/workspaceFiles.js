import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';

const MAX_FILE_SIZE = 1024 * 1024;

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const BINARY_EXTS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
  '.woff', '.woff2', '.ttf', '.eot', '.pyc', '.class', '.wasm',
]);

function isPathInside(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isDotfile(name) {
  return name.startsWith('.') && name !== '.' && name !== '..';
}

function realpathOrResolve(targetPath) {
  const resolved = path.resolve(targetPath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export class WorkspaceFileService {
  constructor({ cwd = process.cwd(), stateFile = null } = {}) {
    this.workspaceRoot = realpathOrResolve(cwd);
    this.stateFile = stateFile;
    this.stateWritePromise = Promise.resolve();
  }

  getWorkspace() {
    return {
      cwd: this.workspaceRoot,
      rootName: path.basename(this.workspaceRoot),
    };
  }

  async setWorkspace(nextPath) {
    if (typeof nextPath !== 'string' || !nextPath.trim()) {
      throw new Error('Missing workspace path');
    }
    const resolved = await fs.realpath(path.resolve(nextPath));
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('Workspace path is not a directory');
    this.workspaceRoot = resolved;
    await this.persistWorkspace();
    return this.getWorkspace();
  }

  async restoreWorkspace() {
    if (!this.stateFile) return this.getWorkspace();
    try {
      const state = await this.readState();
      if (typeof state.lastWorkspace !== 'string' || !state.lastWorkspace.trim()) {
        return this.getWorkspace();
      }
      const resolved = await fs.realpath(path.resolve(state.lastWorkspace));
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) this.workspaceRoot = resolved;
    } catch {
      // Missing or invalid app state should not block startup.
    }
    return this.getWorkspace();
  }

  async persistWorkspace() {
    await this.updateState((state) => state);
  }

  async readState() {
    if (!this.stateFile) return {};
    try {
      const state = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    } catch {
      return {};
    }
  }

  async updateState(update) {
    if (!this.stateFile) return;

    const write = this.stateWritePromise.then(async () => {
      try {
        const state = await this.readState();
        const nextState = update(state) || state;
        nextState.lastWorkspace = this.workspaceRoot;
        nextState.updatedAt = Date.now();
        await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
        await fs.writeFile(this.stateFile, JSON.stringify(nextState, null, 2), 'utf8');
      } catch {
        // Opening a project should still work if the app state file is unavailable.
      }
    });
    this.stateWritePromise = write.catch(() => {});
    await write;
  }

  async getActiveSessionId() {
    const state = await this.readState();
    const activeSessions = state.activeSessionsByWorkspace;
    const sessionId = activeSessions && typeof activeSessions === 'object'
      ? activeSessions[this.workspaceRoot]
      : null;
    return typeof sessionId === 'string' && sessionId.trim() ? sessionId : null;
  }

  async setActiveSessionId(sessionId) {
    if (sessionId !== null && (typeof sessionId !== 'string' || !sessionId.trim())) {
      throw new Error('Invalid active session id');
    }

    await this.updateState((state) => {
      const activeSessions = state.activeSessionsByWorkspace && typeof state.activeSessionsByWorkspace === 'object'
        ? { ...state.activeSessionsByWorkspace }
        : {};
      if (sessionId) activeSessions[this.workspaceRoot] = sessionId;
      else delete activeSessions[this.workspaceRoot];
      return { ...state, activeSessionsByWorkspace: activeSessions };
    });
    return sessionId;
  }

  safePath(requestedPath) {
    const resolved = path.resolve(this.workspaceRoot, requestedPath || '.');
    if (!isPathInside(this.workspaceRoot, resolved)) return null;
    return resolved;
  }

  async resolveSafePath(requestedPath) {
    const lexicalPath = this.safePath(requestedPath);
    if (!lexicalPath) return null;

    const [workspaceRoot, targetPath] = await Promise.all([
      fs.realpath(this.workspaceRoot).catch(() => this.workspaceRoot),
      fs.realpath(lexicalPath).catch(() => null),
    ]);
    if (!targetPath || !isPathInside(workspaceRoot, targetPath)) return null;
    return targetPath;
  }

  isProtectedWorkspacePath(absPath) {
    const relativePath = path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
    const segments = relativePath.split('/').filter(Boolean);
    return (
      segments.includes('.claude') ||
      segments.includes('.codex') ||
      segments.includes('.git') ||
      segments.includes('node_modules')
    );
  }

  async buildTree(dirPath, options = {}) {
    const { depth = 4, showDotfiles = false, maxItems = 800 } = options;
    let count = 0;

    const build = async (nodePath, nodeDepth) => {
      if (nodeDepth > depth || count >= maxItems) return null;
      let entries;
      try {
        entries = await fs.readdir(nodePath, { withFileTypes: true });
      } catch {
        return null;
      }

      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const children = [];
      const directoryNodes = [];
      for (const entry of entries) {
        if (count >= maxItems) break;
        if (!showDotfiles && isDotfile(entry.name)) continue;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isSymbolicLink()) continue;

        const absPath = path.join(nodePath, entry.name);
        const relativePath = path.relative(this.workspaceRoot, absPath) || '.';
        const node = {
          name: entry.name,
          path: relativePath.replace(/\\/g, '/'),
          isDirectory: entry.isDirectory(),
        };
        count += 1;

        if (entry.isDirectory()) {
          const nested = await build(absPath, nodeDepth + 1);
          node.children = nested || [];
          directoryNodes.push(node);
        } else {
          children.push(node);
        }
      }

      return [...directoryNodes, ...children];
    };

    return await build(dirPath, 0);
  }

  async listTree(options = {}) {
    const {
      path: requestedPath = '.',
      depth: requestedDepth = 5,
      showDotfiles = true,
      maxItems: requestedMaxItems = 10000,
    } = options;
    const targetPath = await this.resolveSafePath(requestedPath);
    if (!targetPath) throw new Error('Access denied');

    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) throw new Error('Not a directory');

    const depth = Math.min(Number.parseInt(String(requestedDepth), 10) || 4, 10);
    const rawMaxItems = Number.parseInt(String(requestedMaxItems), 10);
    const maxItems = Math.min(Math.max(Number.isFinite(rawMaxItems) ? rawMaxItems : 800, 100), 20000);
    const tree = await this.buildTree(targetPath, { depth, showDotfiles: Boolean(showDotfiles), maxItems });

    return {
      tree,
      root: path.relative(this.workspaceRoot, targetPath) || '.',
      cwd: this.workspaceRoot,
      rootName: path.basename(this.workspaceRoot),
    };
  }

  async scanFiles(options = {}) {
    const { q = '', limit: requestedLimit = 50 } = options;
    const query = String(q || '').toLowerCase();
    const limit = Math.min(Number.parseInt(String(requestedLimit), 10) || 50, 100);
    const excludeDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage']);
    const files = [];

    const scanDir = async (dir, basePath = '') => {
      if (files.length >= limit) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (files.length >= limit) break;
        if (excludeDirs.has(entry.name) || isDotfile(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          await scanDir(fullPath, relativePath);
        } else if (entry.isFile() && (!query || relativePath.toLowerCase().includes(query))) {
          files.push(relativePath);
        }
      }
    };

    await scanDir(this.workspaceRoot);
    return { files: files.slice(0, limit) };
  }

  async readFile(filePath) {
    const requestedPath = typeof filePath === 'string' ? filePath : filePath?.path;
    const absPath = await this.resolveSafePath(requestedPath);
    if (!absPath) throw new Error('Access denied');

    const stat = await fs.stat(absPath);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    }

    const ext = path.extname(absPath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      const data = await fs.readFile(absPath);
      return {
        content: data.toString('base64'),
        isImage: true,
        mimeType: ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1).replace('jpg', 'jpeg')}`,
        path: requestedPath,
        size: stat.size,
      };
    }
    if (BINARY_EXTS.has(ext)) {
      return { content: null, isBinary: true, path: requestedPath, size: stat.size };
    }

    const content = await fs.readFile(absPath, 'utf-8');
    return { content, isImage: false, isBinary: false, path: requestedPath, size: stat.size };
  }

  async saveFile({ path: requestedPath, content } = {}) {
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
      throw new Error('Missing file path');
    }
    if (typeof content !== 'string') {
      throw new Error('Content must be text');
    }

    const absPath = await this.resolveSafePath(requestedPath);
    if (!absPath) throw new Error('Access denied');
    if (this.isProtectedWorkspacePath(absPath)) {
      throw new Error('Protected workspace files cannot be modified');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(MAX_FILE_SIZE / 1024 / 1024).toFixed(1)} MB limit)`);
    }

    const stat = await fs.stat(absPath);
    if (!stat.isFile()) throw new Error('Not a file');
    const ext = path.extname(absPath).toLowerCase();
    if (IMAGE_EXTS.has(ext) || BINARY_EXTS.has(ext)) {
      throw new Error('Binary files cannot be edited');
    }

    await fs.writeFile(absPath, content, 'utf-8');
    const updatedStat = await fs.stat(absPath);
    return {
      ok: true,
      path: path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/'),
      size: updatedStat.size,
      mtimeMs: updatedStat.mtimeMs,
    };
  }
}
