import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

interface PromptRule {
  id: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
}

export default function PromptEnhancerSection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem('promptEnhancerEnabled') === 'true';
  });
  const [rules, setRules] = useState<PromptRule[]>(() => {
    const saved = localStorage.getItem('promptEnhancerRules');
    return saved ? JSON.parse(saved) : [];
  });

  const handleEnabledChange = (val: boolean) => {
    setEnabled(val);
    localStorage.setItem('promptEnhancerEnabled', String(val));
  };

  const addRule = () => {
    const newRule: PromptRule = {
      id: Date.now().toString(),
      pattern: '',
      replacement: '',
      enabled: true,
    };
    const newRules = [...rules, newRule];
    setRules(newRules);
    localStorage.setItem('promptEnhancerRules', JSON.stringify(newRules));
  };

  const updateRule = (id: string, field: keyof PromptRule, value: string | boolean) => {
    const newRules = rules.map(r => r.id === id ? { ...r, [field]: value } : r);
    setRules(newRules);
    localStorage.setItem('promptEnhancerRules', JSON.stringify(newRules));
  };

  const removeRule = (id: string) => {
    const newRules = rules.filter(r => r.id !== id);
    setRules(newRules);
    localStorage.setItem('promptEnhancerRules', JSON.stringify(newRules));
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.prompt.title')}</h3>
      <p className="settings-desc">{t('settings.prompt.desc')}</p>

      <div className="setting-group">
        <label className="prompt-enhancer-toggle-row" htmlFor="prompt-enhancer-enabled">
          <span className="prompt-enhancer-toggle-copy">
            <span className="prompt-enhancer-toggle-title">{t('settings.prompt.enable')}</span>
            <span className="setting-help">{t('settings.prompt.enableHelp')}</span>
          </span>
          <span className="toggle">
            <input
              id="prompt-enhancer-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleEnabledChange(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </span>
        </label>
      </div>

      <div className="setting-group prompt-enhancer-notice-grid">
        <div className="prompt-enhancer-notice-card">
          <p className="prompt-enhancer-notice-title">{t('settings.prompt.localRulesTitle')}</p>
          <p className="prompt-enhancer-notice-copy">{t('settings.prompt.localRulesDescription')}</p>
        </div>
        <div className="prompt-enhancer-notice-card">
          <p className="prompt-enhancer-notice-title">{t('settings.prompt.manualAiTitle')}</p>
          <p className="prompt-enhancer-notice-copy">{t('settings.prompt.manualAiDescription')}</p>
        </div>
      </div>

      {enabled && (
        <div className="setting-group">
          <label>{t('settings.prompt.rules')}</label>
          {rules.length === 0 ? (
            <p className="setting-help">{t('settings.prompt.rulesEmpty')}</p>
          ) : null}
          <div className="prompt-rules-list">
            {rules.map(rule => (
              <div key={rule.id} className="prompt-rule-item">
                <div className="rule-fields">
                  <input
                    type="text"
                    aria-label={t('settings.prompt.patternLabel')}
                    placeholder={t('settings.prompt.patternLabel')}
                    value={rule.pattern}
                    onChange={(e) => updateRule(rule.id, 'pattern', e.target.value)}
                    className="rule-pattern"
                  />
                  <input
                    type="text"
                    aria-label={t('settings.prompt.replacementLabel')}
                    placeholder={t('settings.prompt.replacementLabel')}
                    value={rule.replacement}
                    onChange={(e) => updateRule(rule.id, 'replacement', e.target.value)}
                    className="rule-replacement"
                  />
                </div>
                <div className="rule-actions">
                  <label
                    className="toggle"
                    title={rule.enabled ? t('settings.prompt.disableRule') : t('settings.prompt.enableRule')}
                    aria-label={rule.enabled ? t('settings.prompt.disableRule') : t('settings.prompt.enableRule')}
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => updateRule(rule.id, 'enabled', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <button
                    type="button"
                    className="provider-icon-button danger"
                    onClick={() => removeRule(rule.id)}
                    title={t('settings.prompt.deleteRule')}
                    aria-label={t('settings.prompt.deleteRule')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="provider-secondary-button" onClick={addRule}>
            <Plus size={14} />
            {t('settings.prompt.addRule')}
          </button>
        </div>
      )}
    </div>
  );
}
