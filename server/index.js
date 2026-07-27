import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import os from 'node:os';
import fs from 'fs/promises';
import { existsSync, watch } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { assistantEvent, permissionRequestEvent, sessionEvent, streamEvent } from './protocol.js';
import { createSessionStore } from './sessionStore.js';
import { dispatchSessionCommand } from './sessionBridge.js';
import { createAssistantTurn } from './assistantTurn.js';
import { extractToolResults } from './toolResults.js';
import { isMissingClaudeConversationError, staleSessionErrorEvent } from './sessionRecovery.js';
import { claudeProjectSessionsDir, syncSessionStoreWithClaude, sessionListEventFromSync } from './sessionSync.js';
import { readClaudeSessionMessages } from './claudeHistory.js';
import { createPermissionPolicy } from './permissionPolicy.js';
import { buildClaudeQueryOptions } from './queryOptions.js';
import { createUsageUpdate, extractUsageFromSdkEvent } from '../src/utils/contextUsage.js';

const require = createRequire(import.meta.url);
const { createTwoFilesPatch } = require('diff');

// ─── Claude Agent SDK ──────────────────────────────────────────────
let sdkQuery;
try {
  const sdk = require('@anthropic-ai/claude-agent-sdk');
  sdkQuery = sdk.query;
} catch (err) {
  console.error(
    '\n\x1b[31m[Claude Agent SDK] Failed to load.\x1b[0m\n' +
    '  → Run: npm install\n' +
    '  → Ensure claude CLI is installed: npm install -g @anthropic-ai/claude-code\n'
  );
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In dev mode, Vite runs on DEPLOY_RUN_PORT (5000) and proxies API to us.
// In production, we serve everything directly on DEPLOY_RUN_PORT.
const isDev = process.env.NODE_ENV !== 'production';
const PORT = isDev
  ? parseInt(process.env.API_PORT || '3456', 10)
  : parseInt(process.env.DEPLOY_RUN_PORT || process.env.PORT || '3456', 10);
const CWD = process.cwd();
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const HOME_DIR = process.env.HOME || os.homedir() || '/tmp';
const SESSIONS_DIR = path.join(HOME_DIR, '.ccnexus', 'sessions');
const CLAUDE_PROJECT_SESSIONS_DIR = claudeProjectSessionsDir({ homeDir: HOME_DIR, cwd: CWD });
const sessionStore = createSessionStore(SESSIONS_DIR);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const BINARY_EXTS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
  '.woff', '.woff2', '.ttf', '.eot', '.pyc', '.class', '.wasm',
]);

// ─── Ensure sessions dir ──────────────────────────────────────────
await fs.mkdir(SESSIONS_DIR, { recursive: true });

// ─── Security ─────────────────────────────────────────────────────
function safePath(requestedPath) {
  const resolved = path.resolve(requestedPath || CWD);
  if (!resolved.startsWith(CWD)) return null;
  return resolved;
}

function isDotfile(name) {
  return name.startsWith('.') && name !== '.' && name !== '..';
}

// ─── File tree ────────────────────────────────────────────────────
async function buildTree(dirPath, options = {}) {
  const { depth = 4, showDotfiles = false, maxItems = 800 } = options;
  let count = 0;

  async function build(nodePath, nodeDepth) {
    if (nodeDepth > depth || count >= maxItems) return null;
    let entries;
    try {
      entries = await fs.readdir(nodePath, { withFileTypes: true });
    } catch { return null; }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const children = [];
    for (const entry of entries) {
      if (count >= maxItems) break;
      if (!showDotfiles && isDotfile(entry.name)) continue;
      const fullPath = path.join(nodePath, entry.name);
      const relativePath = path.relative(CWD, fullPath);
      const isDir = entry.isDirectory();
      count++;

      if (isDir && nodeDepth < depth) {
        const sub = await build(fullPath, nodeDepth + 1);
        children.push({ name: entry.name, path: relativePath, isDirectory: true, children: sub || [] });
      } else {
        children.push({ name: entry.name, path: relativePath, isDirectory: false });
      }
    }
    return children;
  }

  return (await build(dirPath, 0)) || [];
}

// ─── Session metadata (lightweight index) ─────────────────────────
async function loadSessionIndex() {
  return sessionStore.listSessions();
}

async function addSession(sessionId, title) {
  return sessionStore.saveSession({
    id: sessionId,
    title: title || `Session ${sessionId.slice(0, 8)}`,
    updatedAt: Date.now(),
  });
}

async function updateSessionTitle(sessionId, title) {
  const index = await loadSessionIndex();
  const entry = index.find((s) => s.id === sessionId);
  if (entry) await sessionStore.saveSession({ ...entry, title });
}

async function deleteSession(sessionId) {
  await sessionStore.deleteSession(sessionId);
}

function forgetSessionState(sessionId) {
  sessionMessages.delete(sessionId);
  fileEditHistory.delete(sessionId);
  activeQueries.delete(sessionId);
}

async function syncPersistedSessionsWithClaude() {
  return syncSessionStoreWithClaude(sessionStore, {
    claudeProjectDir: CLAUDE_PROJECT_SESSIONS_DIR,
    protectedSessionIds: activeQueries.keys(),
  });
}

// ─── Permission handling ──────────────────────────────────────────
const pendingPermissions = new Map(); // requestId → { resolve, toolName, input }

function requestPermissionFromClient(ws, toolName, input, options) {
  const requestId = Math.random().toString(36).slice(2, 12);
  return new Promise((resolve) => {
    pendingPermissions.set(requestId, { resolve, toolName, input });
    ws.send(JSON.stringify(permissionRequestEvent({
      requestId,
      toolName,
      input,
      title: options?.title || `Allow ${toolName}?`,
      displayName: options?.displayName || toolName,
    })));
    // Timeout after 5 minutes.
    setTimeout(() => {
      if (pendingPermissions.has(requestId)) {
        pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
      }
    }, 300000);
  });
}

function createPermissionHandler(ws) {
  const policy = createPermissionPolicy({
    askUser: (toolName, input, options) => requestPermissionFromClient(ws, toolName, input, options),
  });
  return policy.canUseTool;
}

// ─── Active queries ───────────────────────────────────────────────
const activeQueries = new Map(); // sessionId → Query

// ─── Message history per session (for Rewind) ────────────────────
const sessionMessages = new Map(); // sessionId → ChatMessage[]

// ─── File edit tracking (for Undo) ───────────────────────────────
const fileEditHistory = new Map(); // sessionId → Map<filePath, originalContent>

// ─── Pending plan approvals ──────────────────────────────────────
const pendingPlanApprovals = new Map(); // planId → { resolve, ws }

// ─── Pending user questions ──────────────────────────────────────
const pendingUserQuestions = new Map(); // questionId → { resolve, ws }

// ─── Sub-agent tracking ──────────────────────────────────────────
const sessionSubAgents = new Map(); // sessionId → SubAgentInfo[]

// ─── Express app ──────────────────────────────────────────────────
const app = express();
const server = createServer(app);
app.use(express.json({ limit: '10mb' }));

// File tree API
app.get('/api/files/tree', async (req, res) => {
  try {
    const targetPath = safePath(req.query.path || CWD);
    if (!targetPath) return res.status(403).json({ error: 'Access denied' });
    const depth = Math.min(parseInt(req.query.depth || '4', 10), 10);
    const showDotfiles = req.query.showDotfiles === 'true';
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
    const tree = await buildTree(targetPath, { depth, showDotfiles });
    res.json({ tree, root: path.relative(CWD, targetPath) || '.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// File content API
app.get('/api/files/content', async (req, res) => {
  try {
    const filePath = safePath(req.query.path);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
    if (stat.size > MAX_FILE_SIZE) {
      return res.status(413).json({ error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)` });
    }
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      const data = await fs.readFile(filePath);
      return res.json({ content: data.toString('base64'), isImage: true, mimeType: ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1).replace('jpg', 'jpeg')}`, path: req.query.path, size: stat.size });
    }
    if (BINARY_EXTS.has(ext)) {
      return res.json({ content: null, isBinary: true, path: req.query.path, size: stat.size });
    }
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content, isImage: false, isBinary: false, path: req.query.path, size: stat.size });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: err.message });
  }
});

// Diff API
app.post('/api/diff', async (req, res) => {
  try {
    const { filePath, newContent } = req.body;
    const absPath = safePath(filePath);
    if (!absPath) return res.status(403).json({ error: 'Access denied' });
    let original = '';
    try { original = await fs.readFile(absPath, 'utf-8'); } catch { /* new file */ }
    const patch = createTwoFilesPatch(absPath, absPath, original, newContent, 'Original', 'Modified');
    const diff2html = createDiff2Html();
    const html = diff2html.html(patch, { drawFileList: false, matching: 'lines', outputFormat: 'side-by-side' });
    res.json({ patch, html, original, modified: newContent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Session APIs
app.get('/api/sessions', async (_req, res) => {
  const { sessions } = await syncPersistedSessionsWithClaude();
  res.json(sessions);
});

app.put('/api/sessions/:id', async (req, res) => {
  const { title } = req.body;
  if (title) await updateSessionTitle(req.params.id, title);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', async (req, res) => {
  await deleteSession(req.params.id);
  res.json({ ok: true });
});

// Rewind API — get messages up to a certain point
app.post('/api/sessions/:id/rewind', async (req, res) => {
  try {
    const { messageId } = req.body;
    const sessionId = req.params.id;
    const messages = sessionMessages.get(sessionId) || [];
    const targetIdx = messages.findIndex(m => m.id === messageId);
    if (targetIdx < 0) return res.status(404).json({ error: 'Message not found' });
    const truncated = messages.slice(0, targetIdx + 1);
    sessionMessages.set(sessionId, truncated);
    res.json({ ok: true, messages: truncated, count: truncated.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// File undo API — restore a file to its original content before edits
app.post('/api/files/undo', async (req, res) => {
  try {
    const { filePath, sessionId } = req.body;
    const absPath = safePath(filePath);
    if (!absPath) return res.status(403).json({ error: 'Access denied' });
    const history = sessionId ? fileEditHistory.get(sessionId) : null;
    if (!history || !history.has(absPath)) {
      return res.status(404).json({ error: 'No original content found for this file' });
    }
    const originalContent = history.get(absPath);
    await fs.writeFile(absPath, originalContent, 'utf-8');
    history.delete(absPath);
    res.json({ ok: true, filePath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get tracked file edits for a session
app.get('/api/sessions/:id/edits', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const history = fileEditHistory.get(sessionId);
    if (!history) return res.json({ files: [] });
    const files = Array.from(history.keys()).map(absPath => path.relative(CWD, absPath));
    res.json({ files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Provider & Model Management ──────────────────────────────────
const initSqlJs = require('sql.js');
const CC_SWITCH_DB_PATH = path.join(HOME_DIR, '.cc-switch', 'data.db');
const CLAUDE_SETTINGS_PATH = path.join(HOME_DIR, '.claude', 'settings.json');

// ccGUI 同款模型列表
const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-fable-5', name: 'Claude Fable 5' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
];

// 读取 cc-switch 数据库获取 claude 供应商列表
async function readCcSwitchProviders() {
  try {
    if (!existsSync(CC_SWITCH_DB_PATH)) {
      return [];
    }
    const SQL = await initSqlJs();
    const dbBuffer = await fs.readFile(CC_SWITCH_DB_PATH);
    const db = new SQL.Database(dbBuffer);
    
    const result = db.exec(
      "SELECT * FROM providers WHERE app_type = 'claude' ORDER BY name"
    );
    
    if (result.length === 0) {
      db.close();
      return [];
    }
    
    const columns = result[0].columns;
    const providers = result[0].values.map(row => {
      const obj = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
    
    db.close();
    return providers;
  } catch (err) {
    console.error('[Provider] Failed to read cc-switch database:', err.message);
    return [];
  }
}

// 读取 ~/.claude/settings.json
async function readClaudeSettings() {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) {
      return { env: {} };
    }
    const data = await fs.readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[Provider] Failed to read claude settings:', err.message);
    return { env: {} };
  }
}

// 写入 ~/.claude/settings.json
async function writeClaudeSettings(settings) {
  try {
    const dir = path.dirname(CLAUDE_SETTINGS_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[Provider] Failed to write claude settings:', err.message);
    return false;
  }
}

// 解析实际模型（参考 ccGUI model-utils.js）
function resolveModelFromSettings(modelId, env) {
  const baseModelId = typeof modelId === 'string'
    ? modelId.replace(/\[1m\]$/i, '')
    : modelId;
  // 优先级：ANTHROPIC_MODEL 全局覆盖 > ANTHROPIC_DEFAULT_*_MODEL 按别名映射 > 原模型 ID
  if (env.ANTHROPIC_MODEL) {
    return env.ANTHROPIC_MODEL;
  }
  
  const aliasMap = {
    'claude-sonnet-5': env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    'claude-sonnet-4-6': env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    'claude-fable-5': env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    'claude-opus-4-8': env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    'claude-opus-4-6': env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    'claude-haiku-4-5': env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  };
  
  const mapped = aliasMap[baseModelId];
  if (mapped) {
    return mapped;
  }
  
  return baseModelId;
}

// 获取供应商列表 API
app.get('/api/providers', async (_req, res) => {
  try {
    const providers = await readCcSwitchProviders();
    const settings = await readClaudeSettings();
    const currentProviderId = settings.env?.CC_SWITCH_PROVIDER_ID || null;
    
    res.json({
      providers,
      currentProviderId,
      currentEnv: settings.env || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message, providers: [] });
  }
});

// 切换供应商 API
app.post('/api/providers/switch', async (req, res) => {
  try {
    const { providerId } = req.body;
    
    if (!providerId) {
      return res.status(400).json({ error: 'Provider ID required' });
    }
    
    const providers = await readCcSwitchProviders();
    const provider = providers.find(p => p.id === providerId || p.name === providerId);
    
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    
    const settings = await readClaudeSettings();
    settings.env = settings.env || {};
    
    // 写入供应商配置
    if (provider.base_url) {
      settings.env.ANTHROPIC_BASE_URL = provider.base_url;
    }
    if (provider.api_key) {
      settings.env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
    }
    if (provider.model_mapping) {
      const mapping = typeof provider.model_mapping === 'string' 
        ? JSON.parse(provider.model_mapping) 
        : provider.model_mapping;
      
      if (mapping.sonnet) {
        settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = mapping.sonnet;
      }
      if (mapping.opus) {
        settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = mapping.opus;
      }
      if (mapping.haiku) {
        settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mapping.haiku;
      }
    }
    
    settings.env.CC_SWITCH_PROVIDER_ID = providerId;
    
    const success = await writeClaudeSettings(settings);
    if (!success) {
      return res.status(500).json({ error: 'Failed to write settings' });
    }
    
    res.json({
      ok: true,
      provider,
      env: settings.env,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取当前生效的模型 API
app.get('/api/models/resolve', async (req, res) => {
  try {
    const modelId = req.query.model || 'default';
    const settings = await readClaudeSettings();
    const env = settings.env || {};
    
    const resolvedModel = modelId === 'default' 
      ? (env.ANTHROPIC_MODEL || 'claude-sonnet-5')
      : resolveModelFromSettings(modelId, env);
    
    res.json({
      modelId,
      resolvedModel,
      env,
      availableModels: AVAILABLE_MODELS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取可用模型列表
app.get('/api/models', async (_req, res) => {
  try {
    const settings = await readClaudeSettings();
    const env = settings.env || {};
    
    const modelsWithMapping = AVAILABLE_MODELS.map(m => ({
      ...m,
      resolvedId: resolveModelFromSettings(m.id, env),
    }));
    
    res.json({ models: modelsWithMapping });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取智能体列表（从 ~/.claude/agents/ 读取）
app.get('/api/agents', async (_req, res) => {
  try {
    const agentsDir = path.join(os.homedir(), '.claude', 'agents');
    if (!existsSync(agentsDir)) {
      return res.json({ agents: [] });
    }
    
    const files = await fs.readdir(agentsDir);
    const agents = [];
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      
      const filePath = path.join(agentsDir, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      
      const content = await fs.readFile(filePath, 'utf-8');
      const name = path.basename(file, '.md');
      
      // 解析智能体信息（从 markdown 文件头部提取）
      let description = '';
      const lines = content.split('\n');
      for (const line of lines.slice(0, 10)) {
        if (line.startsWith('description:') || line.startsWith('Description:')) {
          description = line.replace(/^(description|Description):\s*/, '').trim();
          break;
        }
      }
      
      agents.push({
        id: name,
        name: name,
        description: description || `Agent: ${name}`,
        file: filePath,
      });
    }
    
    res.json({ agents });
  } catch (err) {
    console.error('[Agents] Failed to read agents:', err.message);
    res.json({ agents: [] });
  }
});

// 获取进程列表
app.get('/api/processes', (_req, res) => {
  const processes = [];
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.process) {
      processes.push({
        pid: session.process.pid,
        sessionId: sessionId,
        startTime: session.startTime,
        uptime: Date.now() - session.startTime,
      });
    }
  }
  
  res.json({ processes });
});

// 结束进程
app.post('/api/processes/:pid/kill', (req, res) => {
  const pid = parseInt(req.params.pid);
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.process && session.process.pid === pid) {
      try {
        session.process.kill('SIGTERM');
        setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
        
        res.json({ ok: true, pid });
        return;
      } catch (err) {
        res.status(500).json({ error: err.message });
        return;
      }
    }
  }
  
  res.status(404).json({ error: 'Process not found' });
});

// 文件扫描 API（用于文件引用触发器）
app.get('/api/files/scan', async (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const excludeDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage']);
    const files = [];
    
    async function scanDir(dir, basePath = '') {
      if (files.length >= limit) return;
      
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (files.length >= limit) break;
          if (excludeDirs.has(entry.name)) continue;
          if (entry.name.startsWith('.')) continue;
          
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(basePath, entry.name);
          
          if (entry.isDirectory()) {
            await scanDir(fullPath, relativePath);
          } else if (entry.isFile()) {
            if (!query || relativePath.toLowerCase().includes(query.toLowerCase())) {
              files.push(relativePath);
            }
          }
        }
      } catch (err) {
        // Skip directories we can't read
      }
    }
    
    await scanDir(CWD);
    
    res.json({ files: files.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 斜杠命令读取 API
app.get('/api/commands', async (_req, res) => {
  try {
    const commandsDir = path.join(os.homedir(), '.claude', 'commands');
    const commands = [];
    
    // Built-in commands
    const builtInCommands = [
      { name: 'help', description: 'Show help information', args: '' },
      { name: 'clear', description: 'Clear conversation history', args: '' },
      { name: 'compact', description: 'Compact conversation context', args: '' },
      { name: 'cost', description: 'Show token usage and cost', args: '' },
      { name: 'doctor', description: 'Diagnose issues', args: '' },
      { name: 'init', description: 'Initialize project', args: '' },
      { name: 'login', description: 'Login to Claude', args: '' },
      { name: 'logout', description: 'Logout from Claude', args: '' },
      { name: 'status', description: 'Show current status', args: '' },
      { name: 'config', description: 'Show configuration', args: '' },
    ];
    
    commands.push(...builtInCommands.map(c => ({ ...c, source: 'built-in' })));
    
    // Custom commands from ~/.claude/commands/
    if (existsSync(commandsDir)) {
      const files = await fs.readdir(commandsDir);
      
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        const filePath = path.join(commandsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const name = file.replace('.md', '');
        
        // Parse frontmatter if exists
        let description = '';
        let args = '';
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const descMatch = frontmatter.match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
          const argsMatch = frontmatter.match(/args:\s*(.+)/);
          if (argsMatch) args = argsMatch[1].trim();
        }
        
        commands.push({
          name,
          description: description || `Custom command: ${name}`,
          args,
          source: 'custom',
        });
      }
    }
    
    res.json({ commands });
  } catch (err) {
    console.error('[Commands] Failed to read commands:', err.message);
    res.json({ commands: [] });
  }
});

// 提示词管理 API（CRUD）
// 读取提示词列表
app.get('/api/prompts', async (_req, res) => {
  try {
    const promptsDir = path.join(os.homedir(), '.claude', 'prompts');
    const prompts = [];
    
    if (existsSync(promptsDir)) {
      const files = await fs.readdir(promptsDir);
      
      for (const file of files) {
        if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
        
        const filePath = path.join(promptsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const name = file.replace(/\.(md|txt)$/, '');
        
        prompts.push({
          name,
          content,
          file: filePath,
        });
      }
    }
    
    res.json({ prompts });
  } catch (err) {
    console.error('[Prompts] Failed to read prompts:', err.message);
    res.json({ prompts: [] });
  }
});

// 创建/更新提示词
app.post('/api/prompts', async (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }
    
    const promptsDir = path.join(os.homedir(), '.claude', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });
    
    const filePath = path.join(promptsDir, `${name}.md`);
    
    // 防止路径穿越
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(promptsDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(400).json({ error: 'Invalid prompt name' });
    }
    
    await fs.writeFile(filePath, content, 'utf-8');
    res.json({ success: true, file: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除提示词
app.delete('/api/prompts/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const promptsDir = path.join(os.homedir(), '.claude', 'prompts');
    const filePath = path.join(promptsDir, `${name}.md`);
    
    // 防止路径穿越
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(promptsDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(400).json({ error: 'Invalid prompt name' });
    }
    
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Prompt not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 智能体详情 API
app.get('/api/agents/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const agentsDir = path.join(os.homedir(), '.claude', 'agents');
    const filePath = path.join(agentsDir, `${name}.md`);
    
    // 防止路径穿越
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(agentsDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(400).json({ error: 'Invalid agent name' });
    }
    
    if (existsSync(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // 解析 YAML front matter
      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let metadata = {};
      
      if (frontMatterMatch) {
        const yamlContent = frontMatterMatch[1];
        const lines = yamlContent.split('\n');
        
        for (const line of lines) {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            metadata[key] = value;
          }
        }
      }
      
      res.json({
        name,
        description: metadata.description || '',
        tools: metadata.tools ? metadata.tools.split(',').map(t => t.trim()) : [],
        model: metadata.model || '',
        content,
        file: filePath,
      });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));
}

// ─── WebSocket ────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastJson(payload) {
  for (const client of wss.clients) sendJson(client, payload);
}

let sessionSyncInFlight = false;
async function syncAndBroadcastExternalSessionDeletes() {
  if (sessionSyncInFlight) return;
  sessionSyncInFlight = true;
  try {
    const result = await syncPersistedSessionsWithClaude();
    if (!result.deletedSessionIds.length) return;
    for (const sessionId of result.deletedSessionIds) forgetSessionState(sessionId);
    broadcastJson(sessionListEventFromSync(result));
  } catch (err) {
    console.error('[sessions] failed to sync Claude Code sessions:', err.message);
  } finally {
    sessionSyncInFlight = false;
  }
}

function startClaudeSessionMonitor() {
  const timer = setInterval(() => {
    void syncAndBroadcastExternalSessionDeletes();
  }, 2000);
  timer.unref?.();

  try {
    const watcher = watch(CLAUDE_PROJECT_SESSIONS_DIR, { persistent: false }, () => {
      void syncAndBroadcastExternalSessionDeletes();
    });
    watcher.unref?.();
  } catch {
    // The poller above covers first-run cases where Claude has not created the
    // project session directory yet.
  }
}

wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  let currentSessionId = null;
  let latestChatRequest = 0;
  const ownedQueries = new Map();
  const latestRequestBySession = new Map();

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const sessionEventPayload = await dispatchSessionCommand(msg, sessionStore, {
      syncSessions: syncPersistedSessionsWithClaude,
      loadClaudeSessionMessages: (sessionId) => readClaudeSessionMessages({
        claudeProjectDir: CLAUDE_PROJECT_SESSIONS_DIR,
        sessionId,
      }),
    });
    if (sessionEventPayload) {
      if (sessionEventPayload.type === 'session_list' && sessionEventPayload.deletedSessionIds?.length) {
        for (const sessionId of sessionEventPayload.deletedSessionIds) forgetSessionState(sessionId);
      }
      sendJson(ws, sessionEventPayload);
      if (sessionEventPayload.type === 'session_history') {
        currentSessionId = sessionEventPayload.sessionId;
        sessionMessages.set(sessionEventPayload.sessionId, sessionEventPayload.messages);
      }
      return;
    }

    switch (msg.type) {
      case 'chat': {
        const { text, images, sessionId, options: clientOptions } = msg;
        let querySessionId = sessionId || null;
        const requestOrder = ++latestChatRequest;
        currentSessionId = querySessionId;
        if (querySessionId) {
          latestRequestBySession.set(querySessionId, requestOrder);
        }

        // Build prompt
        let prompt = text || '';
        if (images?.length) {
          // Images will be handled as part of the prompt text for now
          prompt += '\n\n[User attached images]';
        }

        const canUseTool = createPermissionHandler(ws);
        const queryOpts = buildClaudeQueryOptions({
          cwd: CWD,
          env: process.env,
          canUseTool,
          clientOptions,
        });
        const modelForUsage = clientOptions?.model && clientOptions.model !== 'default'
          ? clientOptions.model
          : 'claude-sonnet-4-6';
        
        if (querySessionId) {
          queryOpts.resume = querySessionId;
        }

        ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

        let q;
        try {
          q = sdkQuery({ prompt, options: queryOpts });

          // Track user message in history (will be updated with session_id after init)
          const userMsg = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            timestamp: Date.now(),
          };
          const assistantTurn = createAssistantTurn();
          let lastAssistantId = null;

          queryEvents: for await (const event of q) {
            if (ws.readyState !== ws.OPEN) break;

            const usage = extractUsageFromSdkEvent(event);
            if (usage) {
              ws.send(JSON.stringify(createUsageUpdate({
                usage,
                provider: 'claude',
                model: modelForUsage,
              })));
            }

            switch (event.type) {
              case 'system':
                if (event.subtype === 'init') {
                  // Capture session ID
                  querySessionId = event.session_id || querySessionId;
                  if (latestRequestBySession.has(querySessionId)
                    && latestRequestBySession.get(querySessionId) !== requestOrder) {
                    try { q.close(); } catch { /* ignore */ }
                    break queryEvents;
                  }
                  latestRequestBySession.set(querySessionId, requestOrder);
                  if (requestOrder === latestChatRequest) {
                    currentSessionId = querySessionId;
                  }
                  activeQueries.set(querySessionId, q);
                  ownedQueries.set(querySessionId, q);
                  await addSession(querySessionId, prompt.slice(0, 60));
                  ws.send(JSON.stringify(sessionEvent(querySessionId)));
                  
                  // Add user message to history now that we have session_id
                  userMsg.sessionId = querySessionId;
                  if (!sessionMessages.has(querySessionId)) {
                    sessionMessages.set(querySessionId, []);
                  }
                  sessionMessages.get(querySessionId).push(userMsg);
                  await sessionStore.appendMessage(querySessionId, userMsg);
                }
                // Forward system events
                ws.send(JSON.stringify({ type: 'system', subtype: event.subtype, sessionId: event.session_id }));
                break;

              case 'stream_event':
                // Forward streaming events for real-time rendering
                assistantTurn.addStreamEvent(event.event);
                ws.send(JSON.stringify(streamEvent(event.event, event.session_id, event.uuid)));
                break;

              case 'assistant': {
                // One SDK turn can emit a thinking-only assistant message before
                // its text/tool blocks. Keep collecting until the terminal result.
                assistantTurn.add(event.message);
                lastAssistantId = event.uuid || lastAssistantId;
                break;
              }

              case 'user': {
                for (const result of extractToolResults(event.message)) {
                  assistantTurn.addToolResult(result);
                  ws.send(JSON.stringify({
                    ...result,
                    sessionId: event.session_id,
                    uuid: event.uuid,
                  }));
                }
                break;
              }

              case 'result': {
                const finalSessionId = event.session_id || querySessionId;
                const finalAssistant = event.is_error ? null : assistantTurn.complete({
                  id: lastAssistantId || `msg-${Date.now()}`,
                  sessionId: finalSessionId,
                });
                if (finalAssistant) {
                  const assistantMsg = { ...finalAssistant, role: 'assistant', timestamp: Date.now() };
                  if (!sessionMessages.has(finalSessionId)) sessionMessages.set(finalSessionId, []);
                  sessionMessages.get(finalSessionId).push(assistantMsg);
                  await sessionStore.appendMessage(finalSessionId, assistantMsg);
                  for (const block of finalAssistant.content) {
                    if (block.type !== 'tool_use' || !['Edit', 'MultiEdit', 'Write'].includes(block.name)) continue;
                    const filePath = block.input?.file_path || block.input?.path;
                    const absPath = filePath && safePath(filePath);
                    if (!absPath) continue;
                    if (!fileEditHistory.has(finalSessionId)) fileEditHistory.set(finalSessionId, new Map());
                    const history = fileEditHistory.get(finalSessionId);
                    if (!history.has(absPath)) {
                      try { history.set(absPath, await fs.readFile(absPath, 'utf-8')); }
                      catch { history.set(absPath, ''); }
                    }
                  }
                  ws.send(JSON.stringify(assistantEvent(finalAssistant)));
                }
                ws.send(JSON.stringify({
                  type: 'result',
                  subtype: event.subtype,
                  duration: event.duration_ms,
                  cost: event.total_cost_usd,
                  turns: event.num_turns,
                  is_error: event.is_error,
                  sessionId: event.session_id,
                }));
                ws.send(JSON.stringify({ type: 'status', status: 'idle' }));
                break;
              }

              case 'tool_progress':
                ws.send(JSON.stringify({
                  type: 'tool_progress',
                  toolName: event.tool_name,
                  toolUseId: event.tool_use_id,
                  elapsed: event.elapsed_time_seconds,
                  sessionId: event.session_id,
                }));
                break;

              case 'tool_use_summary':
                ws.send(JSON.stringify({
                  type: 'tool_use_summary',
                  summary: event.summary,
                  precedingIds: event.preceding_tool_use_ids,
                  sessionId: event.session_id,
                }));
                break;

              default:
                // Forward other events as generic system messages
                if (event.type && event.type !== 'system') {
                  ws.send(JSON.stringify({ type: 'sdk_event', sdkType: event.type, sessionId: event.session_id }));
                }
                break;
            }
          }
        } catch (err) {
          console.error('[chat] error:', err.message);
          let invalidSessionId = null;
          if (querySessionId && isMissingClaudeConversationError(err.message)) {
            await sessionStore.deleteSession(querySessionId);
            forgetSessionState(querySessionId);
            ownedQueries.delete(querySessionId);
            if (currentSessionId === querySessionId) currentSessionId = null;
            invalidSessionId = querySessionId;
          }
          ws.send(JSON.stringify(invalidSessionId
            ? staleSessionErrorEvent(err.message, invalidSessionId)
            : { type: 'error', message: err.message }));
          ws.send(JSON.stringify({ type: 'status', status: 'idle' }));
        } finally {
          if (querySessionId && activeQueries.get(querySessionId) === q) {
            activeQueries.delete(querySessionId);
          }
          if (querySessionId && ownedQueries.get(querySessionId) === q) {
            ownedQueries.delete(querySessionId);
          }
        }
        break;
      }

      case 'permission_response': {
        const { requestId, allow, behavior, message } = msg;
        const pending = pendingPermissions.get(requestId);
        if (pending) {
          pendingPermissions.delete(requestId);
          const decision = behavior || (allow ? 'allow' : 'deny');
          pending.resolve(decision === 'deny'
            ? { behavior: 'deny', message: message || 'Denied by user' }
            : { behavior: decision });
        }
        break;
      }

      case 'abort': {
        const sessionId = msg.sessionId || currentSessionId;
        const q = ownedQueries.get(sessionId);
        if (q) {
          try { await q.interrupt(); } catch { /* ignore */ }
          try { q.close(); } catch { /* ignore */ }
          if (activeQueries.get(sessionId) === q) activeQueries.delete(sessionId);
          if (ownedQueries.get(sessionId) === q) ownedQueries.delete(sessionId);
        }
        ws.send(JSON.stringify({ type: 'status', status: 'idle' }));
        break;
      }

      case 'rewind': {
        // Rewind to a specific message in the session
        const { messageId, sessionId } = msg;
        const targetSessionId = sessionId || currentSessionId;
        if (!targetSessionId) {
          ws.send(JSON.stringify({ type: 'error', message: 'No session selected' }));
          break;
        }
        const messages = sessionMessages.get(targetSessionId) || [];
        const targetIdx = messages.findIndex(m => m.id === messageId);
        if (targetIdx < 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'Message not found' }));
          break;
        }
        const truncated = messages.slice(0, targetIdx + 1);
        sessionMessages.set(targetSessionId, truncated);
        ws.send(JSON.stringify({ type: 'rewind_complete', messages: truncated }));
        break;
      }

      case 'plan_approval_response': {
        const { planId, approved, feedback } = msg;
        const pending = pendingPlanApprovals.get(planId);
        if (pending) {
          pendingPlanApprovals.delete(planId);
          pending.resolve({ approved, feedback });
        }
        break;
      }

      case 'ask_user_question_response': {
        const { questionId, answer, selectedOption } = msg;
        const pending = pendingUserQuestions.get(questionId);
        if (pending) {
          pendingUserQuestions.delete(questionId);
          pending.resolve({ answer, selectedOption });
        }
        break;
      }

      case 'undo_file': {
        const { filePath, sessionId: undoSessionId } = msg;
        const targetSessionId = undoSessionId || currentSessionId;
        const absPath = safePath(filePath);
        if (!absPath) {
          ws.send(JSON.stringify({ type: 'undo_complete', success: false, error: 'Access denied' }));
          break;
        }
        const history = targetSessionId ? fileEditHistory.get(targetSessionId) : null;
        if (!history || !history.has(absPath)) {
          ws.send(JSON.stringify({ type: 'undo_complete', success: false, error: 'No original content found' }));
          break;
        }
        try {
          const originalContent = history.get(absPath);
          await fs.writeFile(absPath, originalContent, 'utf-8');
          history.delete(absPath);
          ws.send(JSON.stringify({ type: 'undo_complete', success: true, filePath }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'undo_complete', success: false, error: err.message }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[ws] client disconnected');
    // Clean up active queries
    for (const [sessionId, q] of ownedQueries) {
      try { q.close(); } catch { /* ignore */ }
      if (activeQueries.get(sessionId) === q) activeQueries.delete(sessionId);
    }
    ownedQueries.clear();
    latestRequestBySession.clear();
  });
});

// ─── Start ────────────────────────────────────────────────────────
startClaudeSessionMonitor();

server.listen(PORT, () => {
  console.log(`\n\x1b[36m╔══════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║   ccNexus  v2.0              ║\x1b[0m`);
  console.log(`\x1b[36m╚══════════════════════════════════════════╝\x1b[0m`);
  console.log(`\n  Server   → http://localhost:${PORT}`);
  console.log(`  WS       → ws://localhost:${PORT}/ws`);
  console.log(`  CWD      → ${CWD}\n`);
});
