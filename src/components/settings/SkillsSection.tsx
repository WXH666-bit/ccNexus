import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleOff,
  Folder,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deleteSkill, getSkills, importSkills, openSkill, toggleSkill } from '../../utils/desktopBridgeApi';
import { buildSkillsViewModel } from '../../utils/skillsViewModel';

type SkillScope = 'global' | 'local';
type SkillStatus = 'all' | 'enabled' | 'disabled';
type Skill = {
  id: string;
  skillName?: string;
  name: string;
  type: string;
  scope: SkillScope;
  path: string;
  enabled: boolean;
  description?: string;
  warning?: string;
  modifiedAt?: string;
};

function skillFolderName(skill: Skill) {
  if (skill.skillName) return skill.skillName;
  return skill.id.replace(/^(global|local)-/, '').replace(/-disabled$/, '');
}

function scopeLabel(scope: SkillScope) {
  return scope === 'local' ? '项目' : '全局';
}

export default function SkillsSection() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<{ global: Record<string, Skill>; local: Record<string, Skill> }>({ global: {}, local: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | SkillScope>('all');
  const [statusFilter, setStatusFilter] = useState<SkillStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importMenu, setImportMenu] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSkills(await getSkills());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setSkills({ global: {}, local: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const model = useMemo(() => buildSkillsViewModel(skills, { search, scope: scopeFilter, status: statusFilter }), [search, scopeFilter, skills, statusFilter]);

  const handleImport = async (scope: SkillScope) => {
    setImportMenu(false);
    setBusyId(`import-${scope}`);
    setError('');
    try {
      const result = await importSkills(scope) as { canceled?: boolean; success?: boolean; error?: string; errors?: Array<{ error: string }> };
      if (!result.canceled && !result.success) setError(result.error || result.errors?.[0]?.error || '导入 Skill 失败');
      await loadSkills();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (skill: Skill) => {
    setBusyId(skill.id);
    setError('');
    try {
      const result = await toggleSkill({ name: skillFolderName(skill), scope: skill.scope, enabled: skill.enabled }) as { success?: boolean; error?: string };
      if (result.success === false) throw new Error(result.error || 'Skill 启停失败');
      setExpanded(null);
      await loadSkills();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (skill: Skill) => {
    if (!window.confirm(`确定删除 ${scopeLabel(skill.scope)} Skill“${skill.name}”吗？`)) return;
    setBusyId(skill.id);
    setError('');
    try {
      const result = await deleteSkill({ name: skillFolderName(skill), scope: skill.scope, enabled: skill.enabled }) as { success?: boolean; error?: string };
      if (result.success === false) throw new Error(result.error || '删除 Skill 失败');
      setExpanded(null);
      await loadSkills();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusyId(null);
    }
  };

  const handleOpen = async (skill: Skill) => {
    setBusyId(skill.id);
    try {
      const result = await openSkill(skill.path) as { success?: boolean; error?: string };
      if (result.success === false) throw new Error(result.error || '无法打开 Skill');
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="settings-section-content settings-management-section">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.skills.title')}</h3>
          <p className="settings-desc">管理 Claude Code 的全局和项目 Skills。启停会在 Claude 的活动目录与 ccNexus 管理目录之间移动 Skill。</p>
        </div>
        <div className="settings-heading-actions skills-heading-actions">
          <div className="skills-import-wrap">
            <button className="provider-primary-button" onClick={() => setImportMenu(open => !open)} disabled={busyId?.startsWith('import-')}><Plus size={15} /> 导入 Skill <ChevronDown size={13} /></button>
            {importMenu && <div className="skills-import-menu"><button onClick={() => void handleImport('global')}><Folder size={14} />导入到全局</button><button onClick={() => void handleImport('local')}><Folder size={14} />导入到当前项目</button></div>}
          </div>
          <button className="icon-button" onClick={() => void loadSkills()} disabled={loading} title="刷新"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
        </div>
      </div>

      {error && <div className="provider-error" role="alert">{error}</div>}
      <div className="skills-summary-strip">
        <div><strong>{model.counts.all}</strong><span>全部 Skills</span></div>
        <div className="is-enabled"><strong>{model.counts.enabled}</strong><span>已启用</span></div>
        <div className="is-disabled"><strong>{model.counts.disabled}</strong><span>已禁用</span></div>
        <div><strong>{model.counts.global}</strong><span>全局 / {model.counts.local} 项目</span></div>
      </div>

      <div className="skills-filter-toolbar">
        <div className="skills-filter-tabs" role="tablist" aria-label="Skill 作用域">
          <button className={scopeFilter === 'all' ? 'active' : ''} onClick={() => setScopeFilter('all')}>全部 <span>{model.counts.all}</span></button>
          <button className={scopeFilter === 'global' ? 'active' : ''} onClick={() => setScopeFilter('global')}>全局 <span>{model.counts.global}</span></button>
          <button className={scopeFilter === 'local' ? 'active' : ''} onClick={() => setScopeFilter('local')}>项目 <span>{model.counts.local}</span></button>
        </div>
        <div className="skills-filter-tabs skills-status-tabs" role="tablist" aria-label="Skill 状态">
          <button className={statusFilter === 'enabled' ? 'active' : ''} onClick={() => setStatusFilter(statusFilter === 'enabled' ? 'all' : 'enabled')}><Check size={13} />{model.counts.enabled}</button>
          <button className={statusFilter === 'disabled' ? 'active' : ''} onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}><CircleOff size={13} />{model.counts.disabled}</button>
        </div>
        <div className="mcp-search-box skills-search-box"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索 Skill 名称、描述或路径" aria-label="搜索 Skill" /></div>
      </div>

      {loading ? <div className="empty-state"><p>{t('common.loading')}</p></div> : model.items.length === 0 ? (
        <div className="empty-state"><BookOpen size={42} className="empty-icon" /><p>{model.allItems.length ? '没有符合筛选条件的 Skill' : t('settings.skills.empty')}</p><button className="provider-secondary-button" onClick={() => setImportMenu(true)}><Plus size={14} /> 导入 Skill</button></div>
      ) : (
        <div className="skill-card-list">
          {model.items.map(skill => {
            const isBusy = busyId === skill.id;
            return <article key={skill.id} className={`skill-manager-card ${skill.enabled ? '' : 'is-muted'} ${expanded === skill.id ? 'is-expanded' : ''}`}>
              <div className="skill-card-main">
                <button className={`skill-toggle ${skill.enabled ? 'is-on' : ''}`} onClick={() => void handleToggle(skill)} disabled={isBusy} title={skill.enabled ? '禁用 Skill' : '启用 Skill'} aria-label={skill.enabled ? `禁用 ${skill.name}` : `启用 ${skill.name}`}><span /></button>
                <div className="skill-card-icon"><BookOpen size={18} /></div>
                <div className="skill-card-copy"><div className="skill-card-title-row"><strong>{skill.name}</strong><span className={`skill-scope-badge ${skill.scope}`}><Folder size={11} />{scopeLabel(skill.scope)}</span><span className={`skill-state-badge ${skill.enabled ? 'enabled' : 'disabled'}`}>{skill.enabled ? <Check size={12} /> : <CircleOff size={12} />}{skill.enabled ? '已启用' : '已禁用'}</span></div><span className="skill-card-path">{skill.path}</span><span className="skill-card-description">{skill.description || '未填写描述'}</span></div>
                <div className="skill-card-actions"><button className="provider-icon-button" onClick={() => setExpanded(expanded === skill.id ? null : skill.id)} title={expanded === skill.id ? '收起详情' : '展开详情'} aria-label={expanded === skill.id ? '收起详情' : '展开详情'}>{expanded === skill.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button><button className="provider-icon-button" onClick={() => void handleOpen(skill)} disabled={isBusy} title="打开 SKILL.md" aria-label={`打开 ${skill.name}`}><Pencil size={15} /></button><button className="provider-icon-button danger" onClick={() => void handleDelete(skill)} disabled={isBusy} title="删除" aria-label={`删除 ${skill.name}`}><Trash2 size={15} /></button></div>
              </div>
              {expanded === skill.id && <div className="skill-card-details"><div className="skill-detail-line"><span>Skill 目录</span><code>{skill.path}</code></div><div className="skill-detail-line"><span>状态</span><span>{skill.enabled ? '位于 Claude 活动目录，Claude Code 可直接使用' : '位于 ccNexus 管理目录，Claude Code 当前不会加载'}</span></div>{skill.warning && <div className="skill-detail-warning"><CircleOff size={14} />SKILL.md 缺少标准 frontmatter，已按目录名显示</div>}<div className="skill-detail-actions"><button className="provider-secondary-button small" onClick={() => void handleOpen(skill)}><Pencil size={13} /> 打开 SKILL.md</button><button className="provider-secondary-button small" onClick={() => void handleToggle(skill)}>{skill.enabled ? '禁用 Skill' : '启用 Skill'}</button><button className="provider-secondary-button small danger-text" onClick={() => void handleDelete(skill)}><Trash2 size={13} /> 删除</button></div></div>}
            </article>;
          })}
        </div>
      )}
    </div>
  );
}
