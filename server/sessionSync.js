import fs from 'node:fs/promises';
import path from 'node:path';

export function encodeClaudeProjectPath(cwd) {
  return path.resolve(cwd).replace(/[:/\\]/g, '-');
}

export function claudeProjectSessionsDir({ homeDir, cwd }) {
  return path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));
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

export async function syncSessionStoreWithClaude(store, options) {
  const sessions = await store.listSessions();
  const claudeProjectDir = options?.claudeProjectDir;
  if (!claudeProjectDir || !(await directoryExists(claudeProjectDir))) {
    return { sessions, deletedSessionIds: [] };
  }

  const protectedSessionIds = new Set(options?.protectedSessionIds || []);
  const kept = [];
  const deletedSessionIds = [];

  for (const session of sessions) {
    if (protectedSessionIds.has(session.id)) {
      kept.push(session);
      continue;
    }

    const exists = await fileExists(path.join(claudeProjectDir, `${session.id}.jsonl`));
    if (exists) {
      kept.push(session);
      continue;
    }

    await store.deleteSession(session.id);
    deletedSessionIds.push(session.id);
  }

  return { sessions: kept, deletedSessionIds };
}

export function sessionListEventFromSync({ sessions, deletedSessionIds }) {
  const event = { type: 'session_list', sessions };
  if (deletedSessionIds?.length) event.deletedSessionIds = deletedSessionIds;
  return event;
}
