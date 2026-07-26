import fs from 'node:fs/promises';
import path from 'node:path';

const INDEX_FILE = '_index.json';
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sessionFile(directory, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '_index' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session id');
  }
  return path.join(directory, `${sessionId}.json`);
}

export function createSessionStore(directory) {
  const indexFile = path.join(directory, INDEX_FILE);

  async function readIndex() {
    try {
      return JSON.parse(await fs.readFile(indexFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function writeIndex(index) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(indexFile, JSON.stringify(index, null, 2), 'utf8');
  }

  async function saveSession(session) {
    if (!session?.id) throw new Error('Session id is required');
    sessionFile(directory, session.id);

    const index = await readIndex();
    const existingIndex = index.findIndex((entry) => entry.id === session.id);
    const existing = existingIndex >= 0 ? index[existingIndex] : undefined;
    const entry = {
      id: session.id,
      title: session.title ?? existing?.title ?? `Session ${session.id.slice(0, 8)}`,
      updatedAt: session.updatedAt ?? Date.now(),
    };

    if (existingIndex >= 0) index.splice(existingIndex, 1);
    index.unshift(entry);
    await writeIndex(index);
    return entry;
  }

  async function listSessions() {
    const index = await readIndex();
    return [...index].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async function appendMessage(sessionId, message) {
    const messageFile = sessionFile(directory, sessionId);
    let messages;
    try {
      messages = JSON.parse(await fs.readFile(messageFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      messages = [];
    }

    messages.push(message);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(messageFile, JSON.stringify(messages, null, 2), 'utf8');
    await saveSession({ id: sessionId, updatedAt: message.timestamp ?? Date.now() });
    return message;
  }

  async function loadSession(sessionId) {
    try {
      return JSON.parse(await fs.readFile(sessionFile(directory, sessionId), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function deleteSession(sessionId) {
    const messageFile = sessionFile(directory, sessionId);
    const index = await readIndex();
    try {
      await fs.unlink(messageFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await writeIndex(index.filter((entry) => entry.id !== sessionId));
  }

  return { saveSession, appendMessage, listSessions, loadSession, deleteSession };
}
