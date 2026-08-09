import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getWorkspace } from '../../utils/desktopBridgeApi';
import { CLAUDE_MODELS } from '../../utils/modelResolution';
import AppUpdateSection from './AppUpdateSection';

export default function BasicConfigSection() {
  const { t, i18n } = useTranslation();
  const [workspace, setWorkspace] = useState('');
  const [model, setModel] = useState(() => localStorage.getItem('chatModel') || 'default');

  useEffect(() => {
    void getWorkspace().then(result => setWorkspace(result.cwd)).catch(() => setWorkspace(''));
  }, []);

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
          value={workspace}
          readOnly 
        />
      </div>

      <div className="setting-group">
        <label>{t('settings.basic.defaultModel')}</label>
        <select
          value={model}
          onChange={event => {
            const nextModel = event.target.value;
            setModel(nextModel);
            localStorage.setItem('chatModel', nextModel);
            window.dispatchEvent(new Event('ccnexus:chat-preferences-changed'));
          }}
        >
          <option value="default">default</option>
          {CLAUDE_MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
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

      <AppUpdateSection />
    </div>
  );
}
