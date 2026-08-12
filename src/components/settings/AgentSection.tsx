import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Download,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import RefreshIcon from '../RefreshIcon';
import { useTranslation } from 'react-i18next';
import AgentDialog, { type AgentEditorValue } from '../AgentDialog';
import {
  deleteAgent,
  exportAgents,
  getAgents,
  importAgents,
  saveAgent,
  setSelectedAgent,
} from '../../utils/desktopBridgeApi';

interface Agent {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  file?: string;
  source: string;
  editable: boolean;
}

type ImportStrategy = 'skip' | 'overwrite' | 'duplicate';

export default function AgentSection() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ agent: Agent | null } | null>(null);
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>('skip');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getAgents();
      setAgents(Array.isArray(result.agents) ? result.agents as Agent[] : []);
      setSelectedAgentId(result.selectedAgentId || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const handleSave = async (value: AgentEditorValue) => {
    await saveAgent(value);
    setEditor(null);
    await loadAgents();
  };

  const handleSelect = async (agent: Agent) => {
    const nextId = agent.id === selectedAgentId ? null : agent.id;
    try {
      await setSelectedAgent(nextId);
      setSelectedAgentId(nextId);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    }
  };

  const handleDelete = async (agent: Agent) => {
    if (!window.confirm(t('settings.agents.deleteConfirm', '确定删除这个 ccNexus 智能体吗？'))) return;
    try {
      await deleteAgent(agent.id);
      await loadAgents();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const handleExport = async () => {
    try {
      const payload = await exportAgents();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ccnexus-agents.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as { agents?: unknown } | unknown[];
      const imported = Array.isArray(payload) ? payload : payload.agents;
      if (!Array.isArray(imported) && (!imported || typeof imported !== 'object')) {
        throw new Error(t('settings.agents.invalidImport', '导入文件中没有有效的 agents 数据'));
      }
      await importAgents({
        agents: imported as Array<{ id?: string; name?: string; prompt?: string; description?: string }>
          | Record<string, { name?: string; prompt?: string; description?: string }>,
        strategy: importStrategy,
      });
      await loadAgents();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  return (
    <div className="settings-section-content">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.agents.title')}</h3>
          <p className="settings-desc">{t('settings.agents.desc')}</p>
        </div>
        <div className="agent-settings-toolbar">
          <select
            className="agent-import-strategy"
            value={importStrategy}
            onChange={(event) => setImportStrategy(event.target.value as ImportStrategy)}
            aria-label={t('settings.agents.importStrategy', '导入冲突策略')}
          >
            <option value="skip">{t('settings.agents.skipExisting', '跳过重复')}</option>
            <option value="overwrite">{t('settings.agents.overwriteExisting', '覆盖重复')}</option>
            <option value="duplicate">{t('settings.agents.duplicateExisting', '复制重复')}</option>
          </select>
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImportFile(event)} />
          <button className="provider-secondary-button small" onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} />
            {t('settings.agents.import', '导入')}
          </button>
          <button className="provider-secondary-button small" onClick={() => void handleExport()} disabled={agents.filter(agent => agent.source === 'ccnexus').length === 0}>
            <Download size={15} />
            {t('settings.agents.export', '导出')}
          </button>
          <button className="provider-secondary-button small" onClick={() => setEditor({ agent: null })}>
            <Plus size={15} />
            {t('settings.agents.add')}
          </button>
          <button className="icon-button" onClick={() => void loadAgents()} disabled={loading} title={t('common.refresh', { defaultValue: 'Refresh' })}>
            <RefreshIcon size={16} spinning={loading} />
          </button>
        </div>
      </div>

      {error ? <div className="provider-error">{error}</div> : null}

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : agents.length === 0 ? (
        <div className="empty-state">
          <Bot size={42} className="empty-icon" />
          <p>{t('settings.agents.empty')}</p>
          <button className="provider-secondary-button small" onClick={() => setEditor({ agent: null })}>
            <Plus size={15} />
            {t('settings.agents.add')}
          </button>
        </div>
      ) : (
        <div className="agent-settings-list">
          {agents.map(agent => {
            const isManaged = agent.source === 'ccnexus';
            const isSelected = selectedAgentId === agent.id;
            return (
              <div key={agent.id} className={'agent-settings-card ' + (isSelected ? 'selected' : '')}>
                <div className="agent-settings-card-icon">
                  {isManaged ? <Bot size={20} /> : <Lock size={18} />}
                </div>
                <div className="agent-info">
                  <div className="agent-settings-card-title">
                    <strong>{agent.name}</strong>
                    <span className={'agent-source-badge ' + (isManaged ? 'managed' : 'native')}>
                      {isManaged ? t('settings.agents.ccnexusSource', 'ccNexus 托管') : t('settings.agents.claudeSource', 'Claude 原生 · 只读')}
                    </span>
                    {isSelected ? <span className="agent-selected-badge"><Check size={12} />{t('settings.agents.selected', '当前使用')}</span> : null}
                  </div>
                  <span className="agent-settings-card-description">{agent.description || agent.id}</span>
                  <span className="agent-settings-card-id">#{agent.id}</span>
                </div>
                <div className="agent-settings-card-actions">
                  <button className="provider-secondary-button small" onClick={() => void handleSelect(agent)}>
                    {isSelected ? t('settings.agents.unselect', '取消使用') : t('settings.agents.use', '使用')}
                  </button>
                  {agent.editable ? (
                    <>
                      <button className="provider-icon-button" onClick={() => setEditor({ agent })} title={t('common.edit', '编辑')}>
                        <Pencil size={15} />
                      </button>
                      <button className="provider-icon-button danger" onClick={() => void handleDelete(agent)} title={t('common.delete', '删除')}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AgentDialog
        isOpen={Boolean(editor)}
        agent={editor?.agent}
        onClose={() => setEditor(null)}
        onSave={handleSave}
      />
    </div>
  );
}
