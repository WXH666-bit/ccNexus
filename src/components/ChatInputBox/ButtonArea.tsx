import { AlertTriangle, ListOrdered, Send, Sparkles, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfigSelect from '../ConfigSelect';
import ReasoningSelect from '../ReasoningSelect';
import ModeSelect from './ModeSelect';
import ModelSelect from './ModelSelect';
import type { PermissionMode } from '../../types';

interface Props {
  hasInputContent: boolean;
  hasPromptText: boolean;
  isStreaming: boolean;
  mode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
  model: string;
  setModel: (model: string) => void;
  reasoning: string;
  setReasoning: (reasoning: string) => void;
  selectedAgent: string;
  setSelectedAgent: (agent: string) => void;
  streaming: boolean;
  setStreaming: (streaming: boolean) => void;
  alwaysThinking: boolean;
  setAlwaysThinking: (thinking: boolean) => void;
  longContextEnabled: boolean;
  setLongContextEnabled: (enabled: boolean) => void;
  showToolAnchors: boolean;
  setShowToolAnchors: (visible: boolean) => void;
  onProviderSwitch?: () => void;
  onSubmit: (queue?: boolean) => void;
  onEnhancePrompt: () => void;
  onStop: () => void;
}

const EFFORT_SUPPORTED_CLAUDE_MODELS = new Set([
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-opus-4-6[1m]',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
]);

const XHIGH_EFFORT_CLAUDE_MODELS = new Set([
  'claude-fable-5',
  'claude-opus-4-8',
]);

const MAX_EFFORT_CLAUDE_MODELS = new Set([
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-opus-4-6[1m]',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
]);

export default function ButtonArea({
  hasInputContent,
  hasPromptText,
  isStreaming,
  mode,
  setMode,
  model,
  setModel,
  reasoning,
  setReasoning,
  selectedAgent,
  setSelectedAgent,
  streaming,
  setStreaming,
  alwaysThinking,
  setAlwaysThinking,
  longContextEnabled,
  setLongContextEnabled,
  showToolAnchors,
  setShowToolAnchors,
  onProviderSwitch,
  onSubmit,
  onEnhancePrompt,
  onStop,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="button-area" data-provider="claude">
      <div className="button-area-left">
        <ConfigSelect
          selectedAgent={selectedAgent}
          onAgentChange={setSelectedAgent}
          streaming={streaming}
          onStreamingChange={setStreaming}
          alwaysThinking={alwaysThinking}
          onAlwaysThinkingChange={setAlwaysThinking}
          showToolAnchors={showToolAnchors}
          onShowToolAnchorsChange={setShowToolAnchors}
          onProviderSwitch={onProviderSwitch}
        />
        <ModeSelect value={mode} onChange={setMode} />
        <ModelSelect
          value={model}
          onChange={setModel}
          longContextEnabled={longContextEnabled}
          onLongContextChange={setLongContextEnabled}
        />
        <ReasoningSelect
          value={reasoning}
          onChange={setReasoning}
          currentModel={model}
          effortSupportedModels={EFFORT_SUPPORTED_CLAUDE_MODELS}
          xhighEffortModels={XHIGH_EFFORT_CLAUDE_MODELS}
          maxEffortModels={MAX_EFFORT_CLAUDE_MODELS}
          disabled={!alwaysThinking}
        />
      </div>

      <div className="button-area-right">
        <div className="button-divider" />
        <button
          type="button"
          className="enhance-prompt-button"
          disabled={!hasPromptText || isStreaming}
          onClick={onEnhancePrompt}
          title={t('chat.promptEnhancer.trigger', 'Enhance prompt preview')}
        >
          <Sparkles size={16} />
        </button>
        {isStreaming ? (
          <>
            <button
              type="button"
              className="enhance-prompt-button"
              disabled={!hasInputContent}
              onClick={() => onSubmit(true)}
              title="加入队列"
            >
              <ListOrdered size={16} />
            </button>
            <button type="button" className="submit-button stop-button" onClick={onStop} title="停止">
              <Square size={16} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="submit-button"
            onClick={() => onSubmit(false)}
            disabled={!hasInputContent}
            title="Enter 发送"
          >
            <Send size={16} />
          </button>
        )}
        {mode === 'auto' && (
          <span className="auto-mode-badge" title="自动模式：由模型判断">
            自动模式
          </span>
        )}
        {mode === 'bypassPermissions' && (
          <span className="full-access-mode-badge" title="完全访问模式：跳过所有权限检查">
            <AlertTriangle size={13} /> 完全访问
          </span>
        )}
      </div>
    </div>
  );
}
