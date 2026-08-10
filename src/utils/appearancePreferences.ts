export type AppearanceTheme = 'dark' | 'light';

export interface AppearanceBackgroundPreferences {
  opacity: number;
  blur: number;
  overlay: number;
  hasImage: boolean;
  imageMime: string | null;
  imageDataUrl: string | null;
}

export interface AppearancePreferences {
  theme: AppearanceTheme;
  background: AppearanceBackgroundPreferences;
}

export type AppearancePreferencesPatch = Partial<Pick<AppearancePreferences, 'theme'>> & {
  background?: Partial<AppearanceBackgroundPreferences>;
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: 'dark',
  background: {
    opacity: 0.32,
    blur: 0,
    overlay: 0.22,
    hasImage: false,
    imageMime: null,
    imageDataUrl: null,
  },
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeAppearance(value?: Partial<AppearancePreferences> | null): AppearancePreferences {
  const source = value && typeof value === 'object' ? value : {};
  const sourceBackground: Partial<AppearanceBackgroundPreferences> = source.background && typeof source.background === 'object'
    ? source.background
    : {};

  return {
    theme: source.theme === 'light' ? 'light' : 'dark',
    background: {
      opacity: clamp(sourceBackground.opacity, 0, 1, DEFAULT_APPEARANCE.background.opacity),
      blur: clamp(sourceBackground.blur, 0, 24, DEFAULT_APPEARANCE.background.blur),
      overlay: clamp(sourceBackground.overlay, 0, 0.6, DEFAULT_APPEARANCE.background.overlay),
      hasImage: sourceBackground.hasImage === true && Boolean(sourceBackground.imageDataUrl),
      imageMime: typeof sourceBackground.imageMime === 'string' ? sourceBackground.imageMime : null,
      imageDataUrl: typeof sourceBackground.imageDataUrl === 'string'
        && sourceBackground.imageDataUrl.startsWith('data:image/')
        ? sourceBackground.imageDataUrl
        : null,
    },
  };
}

function readNumber(key: string, fallback: number, min: number, max: number) {
  return clamp(Number(localStorage.getItem(key)), min, max, fallback);
}

export function getLocalAppearancePreferences(): AppearancePreferences {
  return normalizeAppearance({
    theme: localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
    background: {
      opacity: readNumber('chatBgOpacity', DEFAULT_APPEARANCE.background.opacity, 0, 1),
      blur: readNumber('chatBgBlur', DEFAULT_APPEARANCE.background.blur, 0, 24),
      overlay: readNumber('chatBgOverlay', DEFAULT_APPEARANCE.background.overlay, 0, 0.6),
      hasImage: false,
      imageMime: null,
      imageDataUrl: null,
    },
  });
}

function imageLayerValue(imageDataUrl: string | null) {
  return imageDataUrl ? `url("${imageDataUrl}")` : 'none';
}

export function applyAppearancePreferences(value: AppearancePreferences): AppearancePreferences {
  const preferences = normalizeAppearance(value);
  const root = document.documentElement;
  const { background } = preferences;

  root.setAttribute('data-theme', preferences.theme);
  root.style.setProperty('--bg-chat', 'var(--bg-primary)');
  root.style.setProperty('--bg-chat-image', imageLayerValue(background.imageDataUrl));
  root.style.setProperty('--chat-bg-image-opacity', String(background.hasImage ? background.opacity : 0));
  root.style.setProperty('--chat-bg-image-blur', `${background.blur}px`);
  root.style.setProperty('--chat-bg-overlay-opacity', String(background.hasImage ? background.overlay : 0));

  localStorage.setItem('theme', preferences.theme);
  localStorage.setItem('chatBgOpacity', String(background.opacity));
  localStorage.setItem('chatBgBlur', String(background.blur));
  localStorage.setItem('chatBgOverlay', String(background.overlay));

  return preferences;
}
