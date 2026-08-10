import { promises as fs } from 'node:fs';
import path from 'node:path';

export const WINDOW_CLOSE_BEHAVIORS = Object.freeze({
  TRAY: 'minimize-to-tray',
  EXIT: 'exit',
});

export const DEFAULT_WINDOW_CLOSE_BEHAVIOR = WINDOW_CLOSE_BEHAVIORS.TRAY;

export function normalizeWindowCloseBehavior(value) {
  return value === WINDOW_CLOSE_BEHAVIORS.EXIT
    ? WINDOW_CLOSE_BEHAVIORS.EXIT
    : DEFAULT_WINDOW_CLOSE_BEHAVIOR;
}

export function shouldMinimizeToTray({ closeBehavior, isQuitting = false } = {}) {
  return !isQuitting && normalizeWindowCloseBehavior(closeBehavior) === WINDOW_CLOSE_BEHAVIORS.TRAY;
}

function normalizeStoredPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    closeBehavior: normalizeWindowCloseBehavior(source.closeBehavior),
  };
}

export class WindowPreferences {
  constructor({ stateFile } = {}) {
    if (!stateFile) throw new Error('WindowPreferences requires stateFile');
    this.stateFile = path.resolve(stateFile);
    this.state = { closeBehavior: DEFAULT_WINDOW_CLOSE_BEHAVIOR };
    this.writePromise = Promise.resolve();
  }

  async load() {
    let stored = {};
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8');
      const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
      stored = JSON.parse(normalized);
    } catch {
      stored = {};
    }

    this.state = normalizeStoredPreferences(stored);
    return this.get();
  }

  get() {
    return { ...this.state };
  }

  async setCloseBehavior(closeBehavior) {
    return this.update({ closeBehavior });
  }

  async update(patch = {}) {
    const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    this.state = normalizeStoredPreferences({
      ...this.state,
      ...source,
    });
    await this.persist();
    return this.get();
  }

  async persist() {
    const serialized = JSON.stringify(this.state, null, 2);
    const temporaryFile = `${this.stateFile}.tmp`;
    const write = this.writePromise.then(async () => {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(temporaryFile, serialized, 'utf8');
      await fs.rename(temporaryFile, this.stateFile);
    });
    this.writePromise = write.catch(() => {});
    await write;
  }
}
