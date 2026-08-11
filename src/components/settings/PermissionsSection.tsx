import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PermissionMode } from '../../types';
import { isPermissionMode } from '../../types';

const MODE_KEY = 'chatMode';

export default function PermissionsSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PermissionMode>(() => {
    const saved = localStorage.getItem(MODE_KEY) || 'default';
    return isPermissionMode(saved) ? saved : 'default';
  });

  useEffect(() => {
    const syncMode = () => {
      const saved = localStorage.getItem(MODE_KEY) || 'default';
      setMode(isPermissionMode(saved) ? saved : 'default');
    };
    window.addEventListener('ccnexus:chat-preferences-changed', syncMode);
    return () => window.removeEventListener('ccnexus:chat-preferences-changed', syncMode);
  }, []);

  const handleModeChange = (nextMode: string) => {
    if (!isPermissionMode(nextMode)) return;
    setMode(nextMode);
    localStorage.setItem(MODE_KEY, nextMode);
    window.dispatchEvent(new Event('ccnexus:chat-preferences-changed'));
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.permissions.title')}</h3>
      <p className="settings-desc">{t('settings.permissions.desc')}</p>

      <div className="setting-group">
        <label><Shield size={14} /> {t('settings.permissions.mode')}</label>
        <select value={mode} onChange={event => handleModeChange(event.target.value)}>
          <option value="default">{t('settings.permissions.modes.default', { defaultValue: '默认模式' })}</option>
          <option value="plan">{t('settings.permissions.modes.plan')}</option>
          <option value="acceptEdits">{t('settings.permissions.modes.acceptEdits')}</option>
          <option value="auto">{t('settings.permissions.modes.auto', { defaultValue: '自动模式' })}</option>
          <option value="bypassPermissions">{t('settings.permissions.modes.fullAccess', { defaultValue: '完全访问模式' })}</option>
        </select>
      </div>

      <div className="settings-info-note">
        <Shield size={15} />
        <span>工具权限仍由聊天中的 ccgui 风格确认弹窗处理；此处只保存当前会话模式。</span>
      </div>
    </div>
  );
}
