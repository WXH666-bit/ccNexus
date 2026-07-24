import { useTranslation } from 'react-i18next';
import { Zap, Plus } from 'lucide-react';

export default function SkillsSection() {
  const { t } = useTranslation();

  return (
    <div className="settings-section-content">
      <h3>{t('settings.skills.title')}</h3>
      <p className="settings-desc">{t('settings.skills.desc')}</p>

      <div className="empty-state">
        <Zap size={48} className="empty-icon" />
        <p>{t('settings.skills.empty')}</p>
        <button className="btn btn-primary">
          <Plus size={14} />
          {t('settings.skills.add')}
        </button>
      </div>
    </div>
  );
}
