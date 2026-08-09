import { Check, ChevronDown, ChevronUp, Plus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CLAUDE_MODELS,
  modelSupportsLongContext,
  resolveModelDisplay,
  stripLongContextSuffix,
} from '../../utils/modelResolution';
import { getProviders } from '../../utils/desktopBridgeApi';

interface ProviderPayload {
  currentEnv?: Record<string, string | undefined>;
}

interface Props {
  value: string;
  onChange: (model: string) => void;
  longContextEnabled: boolean;
  onLongContextChange: (enabled: boolean) => void;
}

const MODEL_ICON_CLASS: Record<string, string> = {
  opus: 'model-option-icon--opus',
  sonnet: 'model-option-icon--sonnet',
  fable: 'model-option-icon--sonnet',
  haiku: 'model-option-icon--haiku',
};

function iconClassFor(modelId: string) {
  const model = CLAUDE_MODELS.find(item => item.id === modelId);
  return model?.mappingKey ? MODEL_ICON_CLASS[model.mappingKey] : 'model-option-icon--default';
}

export default function ModelSelect({
  value,
  onChange,
  longContextEnabled,
  onLongContextChange,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [env, setEnv] = useState<Record<string, string | undefined>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const normalizedValue = stripLongContextSuffix(value) || 'default';
  const selectedModelId = normalizedValue === 'default' ? 'claude-sonnet-4-6' : normalizedValue;
  const currentDisplay = useMemo(
    () => resolveModelDisplay(selectedModelId, env),
    [env, selectedModelId],
  );
  const canUseLongContext = modelSupportsLongContext(selectedModelId);
  const triggerLabel = `${currentDisplay.label}${longContextEnabled && canUseLongContext ? ' (1M上下文)' : ''}`;

  const refreshProviderEnv = useCallback(() => {
    return getProviders()
      .then((data: ProviderPayload) => {
        setEnv(data.currentEnv || {});
      })
      .catch(() => {
        setEnv({});
      });
  }, []);

  useEffect(() => {
    void refreshProviderEnv();
    const handleProviderChanged = () => {
      void refreshProviderEnv();
    };
    window.addEventListener('ccnexus:provider-changed', handleProviderChanged);
    return () => window.removeEventListener('ccnexus:provider-changed', handleProviderChanged);
  }, [refreshProviderEnv]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="model-select-wrap" ref={rootRef}>
      <button
        type="button"
        className="selector-button model-select-trigger"
        onClick={() => {
          setIsOpen(open => {
            const next = !open;
            if (next) void refreshProviderEnv();
            return next;
          });
        }}
        title={`当前模型：${triggerLabel}`}
      >
        <Sparkles size={15} className={`model-option-icon ${iconClassFor(selectedModelId)}`} />
        <span className="selector-button-text">{triggerLabel}</span>
        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {isOpen && (
        <div className="selector-dropdown model-select-dropdown">
          {CLAUDE_MODELS.map(model => {
            const display = resolveModelDisplay(model.id, env);
            const selected = model.id === selectedModelId;

            return (
              <button
                key={model.id}
                type="button"
                className={`selector-option model-select-option ${selected ? 'selected' : ''}`}
                onClick={() => {
                  onChange(model.id);
                  setIsOpen(false);
                }}
              >
                <Sparkles size={17} className={`model-option-icon ${iconClassFor(model.id)}`} />
                <span className="model-option-info">
                  <span className="model-option-label">{display.label}</span>
                  <span className="model-option-subtitle">{display.subtitle}</span>
                </span>
                {selected && <Check size={16} className="model-option-check" />}
              </button>
            );
          })}

          <div className="selector-divider" />

          <div className={`selector-option model-long-context-row ${!canUseLongContext ? 'disabled' : ''}`}>
            <span>1M上下文</span>
            <button
              type="button"
              className={`cc-switch ${longContextEnabled && canUseLongContext ? 'checked' : ''}`}
              disabled={!canUseLongContext}
              onClick={event => {
                event.stopPropagation();
                onLongContextChange(!longContextEnabled);
              }}
              aria-pressed={longContextEnabled && canUseLongContext}
              title={canUseLongContext ? '切换 1M 上下文' : '该模型不支持 1M 上下文'}
            >
              <span />
            </button>
          </div>

          <div className="selector-divider" />

          <button
            type="button"
            className="selector-option model-add-row"
            onClick={() => {
              setIsOpen(false);
              navigate('/settings');
            }}
          >
            <Plus size={18} />
            <span>添加模型</span>
          </button>
        </div>
      )}
    </div>
  );
}
