import { ListOrdered, Send, Sparkles, Square, Zap } from 'lucide-react';
import ConfigSelect from '../ConfigSelect';
import ReasoningSelect from '../ReasoningSelect';
import ModeSelect from './ModeSelect';
import ModelSelect from './ModelSelect';

interface Props {
  hasInputContent: boolean;
  isStreaming: boolean;
  mode: string;
  setMode: (mode: string) => void;
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
  onSubmit: (queue?: boolean) => void;
  onEnhancePrompt: () => void;
  onStop: () => void;
}

const EFFORT_SUPPORTED_CLAUDE_MODELS = new Set([
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-fable-5',
]);

const XHIGH_EFFORT_CLAUDE_MODELS = new Set([
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-6',
]);

const MAX_EFFORT_CLAUDE_MODELS = new Set([
  'claude-opus-4-8',
  'claude-opus-4-6',
]);

export default function ButtonArea({
  hasInputContent,
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
  onSubmit,
  onEnhancePrompt,
  onStop,
}: Props) {
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
          disabled={!hasInputContent || isStreaming}
          onClick={onEnhancePrompt}
          title="增强提示词"
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
        {mode === 'bypassPermissions' && (
          <span className="auto-mode-badge" title="自动模式">
            <Zap size={13} /> 自动模式
          </span>
        )}
      </div>
    </div>
  );
}
