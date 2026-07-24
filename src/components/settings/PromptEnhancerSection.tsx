import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Plus, Trash2 } from 'lucide-react';

interface PromptRule {
  id: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
}

interface PromptEnhancerSectionProps {
  onEnhance?: (text: string) => string;
}

export default function PromptEnhancerSection({ onEnhance }: PromptEnhancerSectionProps) {
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
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleEnabledChange(e.target.checked)}
          />
          <span className="toggle-slider"></span>
          {t('settings.prompt.enable')}
        </label>
      </div>

      {enabled && (
        <>
          <div className="setting-group">
            <label>{t('settings.prompt.rules')}</label>
            <div className="prompt-rules-list">
              {rules.map(rule => (
                <div key={rule.id} className="prompt-rule-item">
                  <div className="rule-fields">
                    <input
                      type="text"
                      placeholder="Pattern (regex)"
                      value={rule.pattern}
                      onChange={(e) => updateRule(rule.id, 'pattern', e.target.value)}
                      className="rule-pattern"
                    />
                    <input
                      type="text"
                      placeholder="Replacement"
                      value={rule.replacement}
                      onChange={(e) => updateRule(rule.id, 'replacement', e.target.value)}
                      className="rule-replacement"
                    />
                  </div>
                  <div className="rule-actions">
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => updateRule(rule.id, 'enabled', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <button className="icon-btn danger" onClick={() => removeRule(rule.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={addRule}>
              <Plus size={14} />
              {t('settings.prompt.addRule')}
            </button>
          </div>

          {onEnhance && (
            <div className="setting-group">
              <label>
                <Sparkles size={14} />
                Test Enhancement
              </label>
              <textarea
                placeholder="Enter text to test enhancement..."
                onBlur={(e) => {
                  if (e.target.value) {
                    const enhanced = onEnhance(e.target.value);
                    console.log('Enhanced:', enhanced);
                  }
                }}
                className="prompt-test-input"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
