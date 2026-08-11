import { useEffect, useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface AgentEditorValue {
  id?: string;
  name: string;
  prompt: string;
}

interface AgentEditorAgent {
  id: string;
  name: string;
  prompt?: string;
}

interface AgentDialogProps {
  isOpen: boolean;
  agent?: AgentEditorAgent | null;
  onClose: () => void;
  onSave: (value: AgentEditorValue) => Promise<void>;
}

export default function AgentDialog({ isOpen, agent, onClose, onSave }: AgentDialogProps) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setId(agent?.id || '');
    setName(agent?.name || '');
    setPrompt(agent?.prompt || '');
    setError('');
  }, [agent, isOpen]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('settings.agents.editor.nameRequired', '请输入智能体名称'));
      return;
    }
    if (!prompt.trim()) {
      setError(t('settings.agents.editor.promptRequired', '请输入智能体提示词'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ id: id.trim() || undefined, name: trimmedName, prompt });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="provider-dialog-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="provider-dialog agent-editor-dialog" onSubmit={(event) => void handleSubmit(event)}>
        <div className="provider-dialog-header">
          <div>
            <h3>{agent ? t('settings.agents.editor.editTitle', '编辑智能体') : t('settings.agents.editor.addTitle', '添加智能体')}</h3>
            <p>{t('settings.agents.editor.desc', '智能体配置保存在 ccNexus 的 agent.json 中，不会修改 Claude Code 文件。')}</p>
          </div>
          <button type="button" className="provider-icon-button" onClick={onClose} aria-label={t('common.close', '关闭')}>
            <X size={18} />
          </button>
        </div>

        <div className="provider-dialog-content">
          {error ? <div className="provider-error">{error}</div> : null}
          <label className="provider-form-field">
            <span>{t('settings.agents.editor.id', '标识')}</span>
            <input
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder={t('settings.agents.editor.idPlaceholder', '例如：frontend-reviewer')}
              readOnly={Boolean(agent)}
            />
            <small>{t('settings.agents.editor.idHint', '只允许字母、数字、点、下划线和短横线；编辑时保持不变。')}</small>
          </label>
          <label className="provider-form-field">
            <span>{t('settings.agents.editor.name', '名称')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.agents.editor.namePlaceholder', '例如：前端审查员')}
              autoFocus
            />
          </label>
          <label className="provider-form-field">
            <span>{t('settings.agents.editor.prompt', '系统提示词')}</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t('settings.agents.editor.promptPlaceholder', '描述这个智能体应该如何工作……')}
              rows={12}
            />
          </label>
        </div>

        <div className="provider-dialog-footer">
          <button type="button" className="provider-secondary-button" onClick={onClose} disabled={saving}>
            {t('common.cancel', '取消')}
          </button>
          <button type="submit" className="provider-primary-button" disabled={saving}>
            <Check size={16} />
            {saving ? t('common.saving', '保存中…') : t('common.save', '保存')}
          </button>
        </div>
      </form>
    </div>
  );
}
