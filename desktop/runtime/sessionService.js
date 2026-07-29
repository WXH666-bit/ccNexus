import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClaudeSessionMessages } from '../../server/claudeHistory.js';
import { claudeProjectSessionsDir } from '../../server/sessionSync.js';

const INDEX_FILE = '_index.json';
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sessionFile(directory, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '_index' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session id');
  }
  return path.join(directory, `${sessionId}.json`);
}

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function titleFromMessages(messages, fallbackTitle) {
  const text = messages
    .find((message) => message?.role === 'user')
    ?.content
    ?.find((block) => block?.type === 'text')
    ?.text;
  return typeof text === 'string' && text.trim()
    ? text.trim().slice(0, 60)
    : fallbackTitle;
}

export class DesktopSessionService {
  constructor({ homeDir = process.env.HOME || os.homedir() || '/tmp', cwd = process.cwd() } = {}) {
    this.homeDir = homeDir;
    this.cwd = cwd;
    this.sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
    this.indexFile = path.join(this.sessionsDir, INDEX_FILE);
  }

  setCwd(nextCwd) {
    this.cwd = nextCwd;
  }

  async readIndex() {
    try {
      return JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      if (error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async writeIndex(index) {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(this.indexFile, JSON.stringify(index, null, 2), 'utf8');
  }

  async listSessions() {
    return [...await this.readIndex()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  claudeProjectDir() {
    return claudeProjectSessionsDir({ homeDir: this.homeDir, cwd: this.cwd });
  }

  async syncWithClaude(options = {}) {
    const sessions = await this.listSessions();
    const claudeDir = this.claudeProjectDir();
    if (!(await directoryExists(claudeDir))) {
      return { sessions, deletedSessionIds: [] };
    }

    const protectedSessionIds = new Set(options.protectedSessionIds || []);
    const kept = [];
    const deletedSessionIds = [];

    for (const session of sessions) {
      if (protectedSessionIds.has(session.id)) {
        kept.push(session);
        continue;
      }
      if (await fileExists(path.join(claudeDir, `${session.id}.jsonl`))) {
        kept.push(session);
        continue;
      }
      try {
        const cachedMessages = JSON.parse(await fs.readFile(sessionFile(this.sessionsDir, session.id), 'utf8'));
        if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
          kept.push(session);
          continue;
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      try {
        await fs.unlink(sessionFile(this.sessionsDir, session.id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      deletedSessionIds.push(session.id);
    }

    const knownIds = new Set(kept.map((session) => session.id));
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = path.basename(entry.name, '.jsonl');
      if (knownIds.has(sessionId)) continue;
      try {
        sessionFile(this.sessionsDir, sessionId);
      } catch {
        continue;
      }

      const filePath = path.join(claudeDir, entry.name);
      const stat = await fs.stat(filePath);
      const messages = await readClaudeSessionMessages({ claudeProjectDir: claudeDir, sessionId });
      const imported = {
        id: sessionId,
        title: titleFromMessages(messages, `Session ${sessionId.slice(0, 8)}`),
        updatedAt: stat.mtimeMs,
      };
      kept.push(imported);
      knownIds.add(sessionId);
    }

    kept.sort((left, right) => right.updatedAt - left.updatedAt);
    await this.writeIndex(kept);
    return { sessions: kept, deletedSessionIds };
  }

  async saveSession(session) {
    if (!session?.id) throw new Error('Session id is required');
    sessionFile(this.sessionsDir, session.id);

    const index = await this.readIndex();
    const existingIndex = index.findIndex((entry) => entry.id === session.id);
    const existing = existingIndex >= 0 ? index[existingIndex] : undefined;
    const entry = {
      id: session.id,
      title: session.title ?? existing?.title ?? `Session ${session.id.slice(0, 8)}`,
      updatedAt: session.updatedAt ?? existing?.updatedAt ?? Date.now(),
    };

    if (existingIndex >= 0) index.splice(existingIndex, 1);
    index.unshift(entry);
    await this.writeIndex(index);
    return entry;
  }

  async getSessions(options = {}) {
    const synced = await this.syncWithClaude(options);
    return { type: 'session_list', sessions: synced.sessions, deletedSessionIds: synced.deletedSessionIds };
  }

  async loadSession(sessionId) {
    let messages;
    try {
      messages = JSON.parse(await fs.readFile(sessionFile(this.sessionsDir, sessionId), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      messages = [];
    }
    if (messages.length === 0) {
      messages = await readClaudeSessionMessages({
        claudeProjectDir: this.claudeProjectDir(),
        sessionId,
      });
    }
    return { type: 'session_history', sessionId, messages };
  }

  async appendMessage(sessionId, message) {
    if (!message || typeof message !== 'object') throw new Error('Message is required');
    const current = await this.loadSession(sessionId);
    const messages = Array.isArray(current.messages) ? current.messages : [];
    const nextMessage = {
      ...message,
      sessionId,
      timestamp: message.timestamp ?? Date.now(),
    };
    messages.push(nextMessage);
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(sessionFile(this.sessionsDir, sessionId), JSON.stringify(messages, null, 2), 'utf8');
    await this.saveSession({
      id: sessionId,
      title: message.role === 'user' && Array.isArray(message.content)
        ? (message.content.find((block) => block?.type === 'text')?.text || '').slice(0, 60)
        : undefined,
      updatedAt: nextMessage.timestamp,
    });
    return nextMessage;
  }

  async renameSession(sessionId, title) {
    if (!title?.trim()) throw new Error('Session title is required');
    await this.saveSession({ id: sessionId, title: title.trim() });
    return { type: 'session_renamed', session_id: sessionId, title: title.trim() };
  }

  async deleteSession(sessionId) {
    const messageFile = sessionFile(this.sessionsDir, sessionId);
    const index = await this.readIndex();
    try {
      await fs.unlink(messageFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await this.writeIndex(index.filter((entry) => entry.id !== sessionId));
    return { type: 'session_deleted', sessionId };
  }
}
