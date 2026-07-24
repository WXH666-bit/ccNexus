import React from 'react';
import { Expand } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LongContextToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

const LongContextToggle: React.FC<LongContextToggleProps> = ({ enabled, onChange, disabled }) => {
  const { t } = useTranslation();

  return (
    <div className={`long-context-toggle ${disabled ? 'disabled' : ''}`}>
      <button
        className="toggle-btn"
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        title={t('longContext.title')}
      >
        <Expand size={16} />
        <span className="toggle-label">{t('longContext.label')}</span>
      </button>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
};

export default LongContextToggle;
