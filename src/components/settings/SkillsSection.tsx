import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSkills } from '../../utils/desktopBridgeApi';

interface Skill {
  id: string;
  name: string;
  type: string;
  scope: string;
  path: string;
  enabled: boolean;
  description?: string;
  modifiedAt?: string;
}

export default function SkillsSection() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<{ global: Record<string, Skill>; local: Record<string, Skill> }>({ global: {}, local: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      setSkills(await getSkills());
    } catch {
      setSkills({ global: {}, local: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const visibleSkills = useMemo(() => [...Object.values(skills.global), ...Object.values(skills.local)]
    .filter(skill => {
      const query = search.trim().toLowerCase();
      return !query || skill.name.toLowerCase().includes(query) || skill.path.toLowerCase().includes(query) || skill.description?.toLowerCase().includes(query);
    })
    .sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)), [search, skills]);

  return (
    <div className="settings-section-content">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.skills.title')}</h3>
          <p className="settings-desc">{t('settings.skills.desc')} 当前按 ccgui 方式读取用户级和项目级 SKILL.md，不修改配置。</p>
        </div>
        <button className="icon-button" onClick={() => void loadSkills()} disabled={loading} title="刷新">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="settings-filter-row">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索 Skill" aria-label="搜索 Skill" />
        <span>{visibleSkills.length} 个</span>
      </div>

      {loading ? <div className="empty-state"><p>{t('common.loading')}</p></div> : visibleSkills.length === 0 ? (
        <div className="empty-state"><BookOpen size={42} className="empty-icon" /><p>{t('settings.skills.empty')}</p></div>
      ) : (
        <div className="skill-settings-list">
          {visibleSkills.map(skill => (
            <div key={skill.id} className={`skill-settings-row ${skill.enabled ? '' : 'muted'}`}>
              <BookOpen size={18} />
              <div className="skill-settings-info">
                <strong>{skill.name}</strong>
                <span>{skill.description || skill.path}</span>
                <small>{skill.path}</small>
              </div>
              <span className="skill-scope-badge">{skill.scope === 'local' ? '项目' : '用户'}</span>
            </div>
          ))}
        </div>
      )}
      </div>
  );
}
