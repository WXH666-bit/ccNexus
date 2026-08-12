import { useEffect, useId, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RefreshIcon from '../RefreshIcon';

type PromptEnhancementAiStatus = 'idle' | 'loading' | 'success' | 'error';

interface PromptEnhancementUseValueState {
  localResult: string;
  aiResult: string;
  aiStatus: PromptEnhancementAiStatus;
}

interface PromptEnhanceDialogProps {
  originalText: string;
  localResult: string;
  aiResult: string;
  aiStatus: PromptEnhancementAiStatus;
  aiError: string;
  onUse: (text: string) => void;
  onCancel: () => void;
  onRestore: () => void;
  onAiEnhance: () => void;
  onCancelAi: () => void;
}

function previewValue(value: string) {
  return value.trim() || '—';
}

export function getPromptEnhancementUseValue(state: PromptEnhancementUseValueState) {
  const { localResult, aiResult, aiStatus } = state;
  if (aiStatus === 'success' && aiResult.trim()) {
    return aiResult;
  }
  return localResult;
}

export default function PromptEnhanceDialog({
  originalText,
  localResult,
  aiResult,
  aiStatus,
  aiError,
  onUse,
  onCancel,
  onRestore,
  onAiEnhance,
  onCancelAi,
}: PromptEnhanceDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryActionRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const useValue = getPromptEnhancementUseValue({ localResult, aiResult, aiStatus });
  const showAiPreview = aiStatus === 'success' && aiResult.trim().length > 0;

  return (
    <div
      className="provider-dialog-overlay prompt-enhance-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div
        className="provider-dialog prompt-enhance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="provider-dialog-header prompt-enhance-header">
          <div>
            <h3 id={titleId}>{t('chat.promptEnhancer.title', 'Prompt enhancement preview')}</h3>
            <p>{t('chat.promptEnhancer.description', 'Review the local rewrite first, then optionally ask AI to polish it.')}</p>
          </div>
          <button
            type="button"
            className="provider-icon-button"
            onClick={onCancel}
            aria-label={t('common.close', 'Close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="provider-dialog-content prompt-enhance-content">
          <div className="prompt-enhance-preview-grid">
            <section className="prompt-enhance-preview">
              <span className="provider-form-section-title">{t('chat.promptEnhancer.original', 'Original draft')}</span>
              <pre>{previewValue(originalText)}</pre>
            </section>

            <section className="prompt-enhance-preview prompt-enhance-preview--local">
              <div className="prompt-enhance-preview-header">
                <span className="provider-form-section-title">{t('chat.promptEnhancer.localResult', 'Local preview')}</span>
                <button
                  ref={primaryActionRef}
                  type="button"
                  className="provider-secondary-button prompt-enhance-inline-action"
                  onClick={() => onUse(localResult)}
                >
                  {t('chat.promptEnhancer.useResult', 'Use result')}
                </button>
              </div>
              <pre>{previewValue(localResult)}</pre>
            </section>

            <section className="prompt-enhance-preview prompt-enhance-preview--ai">
              <div className="prompt-enhance-preview-header">
                <span className="provider-form-section-title">{t('chat.promptEnhancer.aiResult', 'AI polish')}</span>
                {showAiPreview ? (
                  <button
                    type="button"
                    className="provider-secondary-button prompt-enhance-inline-action"
                    onClick={() => onUse(aiResult)}
                  >
                    {t('chat.promptEnhancer.useAiResult', 'Use AI result')}
                  </button>
                ) : null}
              </div>

              {aiStatus === 'loading' ? (
                <div className="prompt-enhance-loading" role="status">
                  <Sparkles size={16} />
                  <span>{t('chat.promptEnhancer.loading', 'Generating AI enhancement…')}</span>
                </div>
              ) : showAiPreview ? (
                <pre>{previewValue(aiResult)}</pre>
              ) : (
                <div className="prompt-enhance-empty">
                  {t('chat.promptEnhancer.aiPlaceholder', 'AI polish appears here after you request it.')}
                </div>
              )}

              {aiStatus === 'error' ? (
                <div className="prompt-enhance-error" role="alert">
                  {aiError || t('chat.promptEnhancer.error', 'AI enhancement failed. You can still use the local preview.')}
                </div>
              ) : null}

              <p className="prompt-enhance-note">
                {t('chat.promptEnhancer.aiNote', 'AI polish uses an extra model request. The local preview always works offline-first.')}
              </p>
            </section>
          </div>
        </div>

        <div className="provider-dialog-footer prompt-enhance-actions">
          <button type="button" className="provider-secondary-button" onClick={onRestore}>
            <RefreshIcon size={16} counterClockwise />
            {t('chat.promptEnhancer.restore', 'Restore original')}
          </button>
          <div className="prompt-enhance-actions-right">
            <button type="button" className="provider-secondary-button" onClick={onCancel}>
              {t('chat.promptEnhancer.cancel', 'Cancel')}
            </button>
            {aiStatus === 'loading' ? (
              <button type="button" className="provider-secondary-button" onClick={onCancelAi}>
                {t('chat.promptEnhancer.cancelAi', 'Cancel AI')}
              </button>
            ) : (
              <button type="button" className="provider-primary-button" onClick={onAiEnhance}>
                <Sparkles size={16} />
                {t('chat.promptEnhancer.aiEnhance', 'AI polish')}
              </button>
            )}
            <button type="button" className="provider-primary-button" onClick={() => onUse(useValue)}>
              {t('chat.promptEnhancer.useResult', 'Use result')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
