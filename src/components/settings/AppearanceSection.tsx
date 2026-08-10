import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  LoaderCircle,
  Moon,
  Palette,
  RotateCcw,
  Sun,
  Upload,
} from 'lucide-react';
import {
  applyAppearancePreferences,
  getLocalAppearancePreferences,
  type AppearanceBackgroundPreferences,
  type AppearancePreferences,
} from '../../utils/appearancePreferences';

export default function AppearanceSection() {
  const { t } = useTranslation();
  const localAppearance = getLocalAppearancePreferences();
  const [theme, setTheme] = useState<'dark' | 'light'>(localAppearance.theme);
  const [fontSize, setFontSize] = useState<string>(
    () => localStorage.getItem('fontSize') || '14'
  );
  const [background, setBackground] = useState<AppearanceBackgroundPreferences>(
    localAppearance.background
  );
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const appearanceLoaded = useRef(!window.ccNexusDesktop);

  useEffect(() => {
    let active = true;
    const loadAppearance = async () => {
      if (!window.ccNexusDesktop) return;
      try {
        const preferences = await window.ccNexusDesktop.getAppearancePreferences();
        if (!active) return;
        appearanceLoaded.current = true;
        setTheme(preferences.theme);
        setBackground(preferences.background);
        applyAppearancePreferences(preferences);
      } catch {
        appearanceLoaded.current = true;
      }
    };
    void loadAppearance();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const preferences: AppearancePreferences = { theme, background };
    applyAppearancePreferences(preferences);
    if (!appearanceLoaded.current) return;
    void window.ccNexusDesktop?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);
    localStorage.setItem('fontSize', fontSize);
  }, [fontSize]);

  const updateBackground = (patch: Partial<AppearanceBackgroundPreferences>) => {
    const nextBackground = { ...background, ...patch };
    const nextAppearance: AppearancePreferences = { theme, background: nextBackground };
    setBackground(nextBackground);
    setBackgroundError(null);
    applyAppearancePreferences(nextAppearance);
    if (appearanceLoaded.current) {
      void window.ccNexusDesktop?.saveAppearancePreferences({ background: patch });
    }
  };

  const syncAppearance = (preferences: AppearancePreferences) => {
    setTheme(preferences.theme);
    setBackground(preferences.background);
    applyAppearancePreferences(preferences);
  };

  const chooseAppearanceBackground = async () => {
    if (!window.ccNexusDesktop) return;
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      const result = await window.ccNexusDesktop.chooseAppearanceBackground();
      if (result.preferences) syncAppearance(result.preferences);
      if (result.error) setBackgroundError(result.error);
    } catch {
      setBackgroundError(t('settings.appearance.background.invalid'));
    } finally {
      setBackgroundBusy(false);
    }
  };

  const clearAppearanceBackground = async () => {
    if (!window.ccNexusDesktop) {
      updateBackground({ hasImage: false, imageMime: null, imageDataUrl: null });
      return;
    }
    setBackgroundBusy(true);
    setBackgroundError(null);
    try {
      const preferences = await window.ccNexusDesktop.clearAppearanceBackground();
      syncAppearance(preferences);
    } catch {
      setBackgroundError(t('settings.appearance.background.invalid'));
    } finally {
      setBackgroundBusy(false);
    }
  };

  const hasDesktopBridge = Boolean(window.ccNexusDesktop);
  const previewStyle = background.imageDataUrl
    ? { backgroundImage: `url("${background.imageDataUrl}")` }
    : undefined;

  return (
    <div className="settings-section-content">
      <h3>{t('settings.appearance.title')}</h3>

      <div className="setting-group">
        <label>{t('settings.appearance.theme')}</label>
        <div className="theme-toggle">
          <button
            type="button"
            className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
          >
            <Moon size={16} />
            <span>{t('settings.appearance.themes.dark')}</span>
          </button>
          <button
            type="button"
            className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
          >
            <Sun size={16} />
            <span>{t('settings.appearance.themes.light')}</span>
          </button>
        </div>
      </div>

      <div className="setting-group">
        <label>{t('settings.appearance.fontSize')}</label>
        <div className="font-size-selector">
          <button
            type="button"
            className={`font-size-btn ${fontSize === '12' ? 'active' : ''}`}
            onClick={() => setFontSize('12')}
          >
            {t('settings.appearance.fontSizes.small')}
          </button>
          <button
            type="button"
            className={`font-size-btn ${fontSize === '14' ? 'active' : ''}`}
            onClick={() => setFontSize('14')}
          >
            {t('settings.appearance.fontSizes.normal')}
          </button>
          <button
            type="button"
            className={`font-size-btn ${fontSize === '16' ? 'active' : ''}`}
            onClick={() => setFontSize('16')}
          >
            {t('settings.appearance.fontSizes.large')}
          </button>
        </div>
      </div>

      <div className="setting-group appearance-background-card">
        <div className="appearance-background-heading">
          <div>
            <label>{t('settings.appearance.background.title')}</label>
            <p>{t('settings.appearance.background.desc')}</p>
          </div>
          <ImageIcon size={20} />
        </div>

        <div className="appearance-background-preview" style={previewStyle}>
          {!background.hasImage && (
            <div className="appearance-background-empty">
              <ImageIcon size={28} />
              <span>{t('settings.appearance.background.empty')}</span>
            </div>
          )}
        </div>

        <div className="appearance-background-actions">
          <button
            type="button"
            className="appearance-background-button primary"
            onClick={() => void chooseAppearanceBackground()}
            disabled={!hasDesktopBridge || backgroundBusy}
          >
            {backgroundBusy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
            <span>{background.hasImage
              ? t('settings.appearance.background.replace')
              : t('settings.appearance.background.choose')}</span>
          </button>
          <button
            type="button"
            className="appearance-background-button"
            onClick={() => void clearAppearanceBackground()}
            disabled={backgroundBusy || !background.hasImage}
          >
            <RotateCcw size={15} />
            <span>{t('settings.appearance.background.reset')}</span>
          </button>
        </div>

        {!hasDesktopBridge && (
          <p className="appearance-background-hint">
            {t('settings.appearance.background.desktopOnly')}
          </p>
        )}
        {backgroundError && <p className="appearance-background-error">{backgroundError}</p>}

        <div className="appearance-range-list">
          <label className="appearance-range-row">
            <span>{t('settings.appearance.background.opacity')}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(background.opacity * 100)}
              onChange={(event) => updateBackground({ opacity: Number(event.target.value) / 100 })}
            />
            <output>{Math.round(background.opacity * 100)}%</output>
          </label>
          <label className="appearance-range-row">
            <span>{t('settings.appearance.background.blur')}</span>
            <input
              type="range"
              min="0"
              max="24"
              value={Math.round(background.blur)}
              onChange={(event) => updateBackground({ blur: Number(event.target.value) })}
            />
            <output>{Math.round(background.blur)}px</output>
          </label>
          <label className="appearance-range-row">
            <span>{t('settings.appearance.background.overlay')}</span>
            <input
              type="range"
              min="0"
              max="60"
              value={Math.round(background.overlay * 100)}
              onChange={(event) => updateBackground({ overlay: Number(event.target.value) / 100 })}
            />
            <output>{Math.round(background.overlay * 100)}%</output>
          </label>
        </div>
      </div>

      <div className="appearance-preview">
        <Palette size={16} />
        <span>Preview text at current font size</span>
      </div>
    </div>
  );
}
