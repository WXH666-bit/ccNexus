import { promises as fs } from 'node:fs';
import path from 'node:path';

export const MAX_BACKGROUND_FILE_SIZE = 8 * 1024 * 1024;

export const DEFAULT_APPEARANCE = Object.freeze({
  theme: 'dark',
  background: Object.freeze({
    opacity: 0.32,
    blur: 0,
    overlay: 0.22,
    hasImage: false,
    imageMime: null,
  }),
});

const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

function clampNumber(value, min, max, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function cloneDefaultAppearance() {
  return {
    theme: DEFAULT_APPEARANCE.theme,
    background: { ...DEFAULT_APPEARANCE.background },
  };
}

function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

function normalizeStoredAppearance(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourceBackground = source.background && typeof source.background === 'object'
    ? source.background
    : {};

  const hasImage = sourceBackground.hasImage === true;
  const imageMime = hasImage
    && typeof sourceBackground.imageMime === 'string'
    && Object.values(IMAGE_MIME_BY_EXTENSION).includes(sourceBackground.imageMime)
    ? sourceBackground.imageMime
    : null;

  return {
    theme: normalizeTheme(source.theme),
    background: {
      opacity: clampNumber(sourceBackground.opacity, 0, 1, DEFAULT_APPEARANCE.background.opacity),
      blur: clampNumber(sourceBackground.blur, 0, 24, DEFAULT_APPEARANCE.background.blur),
      overlay: clampNumber(sourceBackground.overlay, 0, 0.6, DEFAULT_APPEARANCE.background.overlay),
      hasImage,
      imageMime,
    },
  };
}

function toDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export class AppearancePreferences {
  constructor({ stateFile, backgroundFile } = {}) {
    if (!stateFile || !backgroundFile) {
      throw new Error('AppearancePreferences requires stateFile and backgroundFile');
    }
    this.stateFile = path.resolve(stateFile);
    this.backgroundFile = path.resolve(backgroundFile);
    this.state = cloneDefaultAppearance();
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

    this.state = normalizeStoredAppearance(stored);
    await this.reconcileMissingBackground();
    return this.get();
  }

  async get() {
    await this.reconcileMissingBackground();
    const preferences = {
      theme: this.state.theme,
      background: {
        ...this.state.background,
        imageDataUrl: null,
      },
    };

    if (preferences.background.hasImage && preferences.background.imageMime) {
      try {
        const image = await fs.readFile(this.backgroundFile);
        preferences.background.imageDataUrl = toDataUrl(image, preferences.background.imageMime);
      } catch {
        preferences.background.hasImage = false;
        preferences.background.imageMime = null;
      }
    }

    return preferences;
  }

  async setTheme(theme) {
    return this.update({ theme });
  }

  async update(patch = {}) {
    const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const backgroundPatch = source.background && typeof source.background === 'object'
      ? source.background
      : {};
    this.state = normalizeStoredAppearance({
      ...this.state,
      ...source,
      background: {
        ...this.state.background,
        ...backgroundPatch,
      },
    });
    await this.persist();
    return this.get();
  }

  async importBackground(sourcePath) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      throw new Error('请选择一张图片');
    }

    const extension = path.extname(sourcePath).toLowerCase();
    const imageMime = IMAGE_MIME_BY_EXTENSION[extension];
    if (!imageMime) {
      throw new Error('仅支持 PNG、JPG、WebP 或 GIF 图片');
    }

    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) throw new Error('所选路径不是文件');
    if (stat.size > MAX_BACKGROUND_FILE_SIZE) {
      throw new Error('背景图片不能超过 8 MB');
    }

    await fs.mkdir(path.dirname(this.backgroundFile), { recursive: true });
    await fs.copyFile(sourcePath, this.backgroundFile);
    this.state = normalizeStoredAppearance({
      ...this.state,
      background: {
        ...this.state.background,
        hasImage: true,
        imageMime,
      },
    });
    await this.persist();
    return this.get();
  }

  async clearBackground() {
    try {
      await fs.unlink(this.backgroundFile);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    this.state = normalizeStoredAppearance({
      ...this.state,
      background: {
        ...this.state.background,
        hasImage: false,
        imageMime: null,
      },
    });
    await this.persist();
    return this.get();
  }

  async reconcileMissingBackground() {
    if (!this.state.background.hasImage) return;
    try {
      const stat = await fs.stat(this.backgroundFile);
      if (stat.isFile() && this.state.background.imageMime) return;
    } catch {
      // A missing background should never prevent the app from starting.
    }

    this.state = normalizeStoredAppearance({
      ...this.state,
      background: {
        ...this.state.background,
        hasImage: false,
        imageMime: null,
      },
    });
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
