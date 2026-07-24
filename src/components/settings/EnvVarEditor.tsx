import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
}

export default function EnvVarEditor() {
  const { t } = useTranslation();
  const [vars, setVars] = useState<EnvVar[]>([
    { key: 'ANTHROPIC_API_KEY', value: 'sk-***' },
    { key: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', value: '16000' },
  ]);

  const addVar = () => {
    setVars([...vars, { key: '', value: '' }]);
  };

  const updateVar = (index: number, field: 'key' | 'value', val: string) => {
    const newVars = [...vars];
    newVars[index] = { ...newVars[index], [field]: val };
    setVars(newVars);
  };

  const removeVar = (index: number) => {
    setVars(vars.filter((_, i) => i !== index));
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.env.title')}</h3>
      <p className="settings-desc">{t('settings.env.desc')}</p>

      <div className="env-var-list">
        {vars.map((v, idx) => (
          <div key={idx} className="env-var-item">
            <input
              type="text"
              placeholder={t('settings.env.key')}
              value={v.key}
              onChange={(e) => updateVar(idx, 'key', e.target.value)}
              className="env-key"
            />
            <input
              type="text"
              placeholder={t('settings.env.value')}
              value={v.value}
              onChange={(e) => updateVar(idx, 'value', e.target.value)}
              className="env-value"
            />
            <button className="icon-btn danger" onClick={() => removeVar(idx)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button className="btn btn-secondary" onClick={addVar}>
        <Plus size={14} />
        {t('settings.env.add')}
      </button>
    </div>
  );
}
