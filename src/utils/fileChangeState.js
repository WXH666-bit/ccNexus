const KEEP_ALL_BASE_PREFIX = 'keep-all-base-';
const PROCESSED_FILES_PREFIX = 'processed-files-';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  return null;
}

function sessionKey(prefix, sessionId) {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  return normalized ? `${prefix}${normalized}` : null;
}

export function readKeepAllBase(sessionId, storage) {
  const key = sessionKey(KEEP_ALL_BASE_PREFIX, sessionId);
  const target = resolveStorage(storage);
  if (!key || !target) return 0;
  try {
    const value = Number.parseInt(target.getItem(key) || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeKeepAllBase(sessionId, messageIndex, storage) {
  const key = sessionKey(KEEP_ALL_BASE_PREFIX, sessionId);
  const target = resolveStorage(storage);
  if (!key || !target || !Number.isFinite(messageIndex) || messageIndex < 0) return;
  try {
    target.setItem(key, String(Math.floor(messageIndex)));
  } catch {
    // Renderer storage can be unavailable or full; the in-memory state remains usable.
  }
}

export function readProcessedFiles(sessionId, storage) {
  const key = sessionKey(PROCESSED_FILES_PREFIX, sessionId);
  const target = resolveStorage(storage);
  if (!key || !target) return [];
  try {
    const parsed = JSON.parse(target.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter(value => typeof value === 'string' && value.trim())));
  } catch {
    return [];
  }
}

export function writeProcessedFiles(sessionId, filePaths, storage) {
  const key = sessionKey(PROCESSED_FILES_PREFIX, sessionId);
  const target = resolveStorage(storage);
  if (!key || !target) return;
  const normalized = Array.from(new Set((Array.isArray(filePaths) ? filePaths : [])
    .filter(path => typeof path === 'string' && path.trim())));
  try {
    if (normalized.length === 0) target.removeItem(key);
    else target.setItem(key, JSON.stringify(normalized));
  } catch {
    // Renderer storage can be unavailable or full; the in-memory state remains usable.
  }
}

export function cleanupFileChangeState(storage, maxStoredSessions = 50) {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    const keys = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key?.startsWith(KEEP_ALL_BASE_PREFIX) || key?.startsWith(PROCESSED_FILES_PREFIX)) keys.push(key);
    }
    if (keys.length <= maxStoredSessions) return;
    keys.slice(0, keys.length - maxStoredSessions).forEach(key => target.removeItem(key));
  } catch {
    // Cleanup is best effort and must never interrupt chat rendering.
  }
}
