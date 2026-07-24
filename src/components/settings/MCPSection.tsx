import { useTranslation } from 'react-i18next';
import { Server, Plus } from 'lucide-react';

export default function MCPSection() {
  const { t } = useTranslation();

  return (
    <div className="settings-section-content">
      <h3>{t('settings.mcp.title')}</h3>
      <p className="settings-desc">{t('settings.mcp.desc')}</p>

      <div className="empty-state">
        <Server size={48} className="empty-icon" />
        <p>{t('settings.mcp.empty')}</p>
        <button className="btn btn-primary">
          <Plus size={14} />
          {t('settings.mcp.add')}
        </button>
      </div>
    </div>
  );
}
