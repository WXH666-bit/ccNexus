import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Sun, Moon } from 'lucide-react';

export default function AppearanceSection() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  const [fontSize, setFontSize] = useState<string>(
    () => localStorage.getItem('fontSize') || '14'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);
    localStorage.setItem('fontSize', fontSize);
  }, [fontSize]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.appearance.title')}</h3>

      <div className="setting-group">
        <label>{t('settings.appearance.theme')}</label>
        <div className="theme-toggle">
          <button
            className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
          >
            <Moon size={16} />
            <span>{t('settings.appearance.themes.dark')}</span>
          </button>
          <button
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
            className={`font-size-btn ${fontSize === '12' ? 'active' : ''}`}
            onClick={() => setFontSize('12')}
          >
            {t('settings.appearance.fontSizes.small')}
          </button>
          <button
            className={`font-size-btn ${fontSize === '14' ? 'active' : ''}`}
            onClick={() => setFontSize('14')}
          >
            {t('settings.appearance.fontSizes.normal')}
          </button>
          <button
            className={`font-size-btn ${fontSize === '16' ? 'active' : ''}`}
            onClick={() => setFontSize('16')}
          >
            {t('settings.appearance.fontSizes.large')}
          </button>
        </div>
      </div>

      <div className="appearance-preview">
        <Palette size={16} />
        <span>Preview text at current font size</span>
      </div>
    </div>
  );
}
