import { useTranslation } from 'react-i18next';
import { Bot, Plus } from 'lucide-react';

export default function AgentSection() {
  const { t } = useTranslation();

  return (
    <div className="settings-section-content">
      <h3>{t('settings.agents.title')}</h3>
      <p className="settings-desc">{t('settings.agents.desc')}</p>

      <div className="empty-state">
        <Bot size={48} className="empty-icon" />
        <p>{t('settings.agents.empty')}</p>
        <button className="btn btn-primary">
          <Plus size={14} />
          {t('settings.agents.add')}
        </button>
      </div>
    </div>
  );
}
