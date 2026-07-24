import { useTranslation } from 'react-i18next';

export default function BasicConfigSection() {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.sections.basic')}</h3>
      
      <div className="setting-group">
        <label>{t('settings.basic.workDir')}</label>
        <input 
          type="text" 
          defaultValue={typeof window !== 'undefined' ? window.location.origin : ''} 
          readOnly 
        />
      </div>

      <div className="setting-group">
        <label>{t('settings.basic.defaultModel')}</label>
        <select defaultValue="default">
          <option value="default">default</option>
          <option value="claude-sonnet-4-20250514">Sonnet 4</option>
          <option value="claude-opus-4-20250514">Opus 4</option>
        </select>
      </div>

      <div className="setting-group">
        <label>{t('settings.basic.language')}</label>
        <select 
          value={i18n.language} 
          onChange={(e) => handleLanguageChange(e.target.value)}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="setting-group">
        <label>
          <input type="checkbox" defaultChecked />
          {t('settings.basic.autoSave')}
        </label>
      </div>
    </div>
  );
}
