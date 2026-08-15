import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Loader2 } from 'lucide-react';
import ContextBar from './ContextBar';
import InputEditable from './InputEditable';
import CompletionDropdown, { type CompletionItem } from './CompletionDropdown';
import ButtonArea from './ButtonArea';
import PromptEnhanceDialog from './PromptEnhanceDialog';
import { applyLongContextSuffix } from '../../utils/modelResolution';
import { calculateContextPercentage, getModelContextLimit } from '../../utils/contextUsage';
import {
  enhancePrompt,
  cancelPromptEnhancement,
  getAgents,
  getCommands,
  getFileTree,
  getPathForFile,
  getPrompts,
  setSelectedAgent as persistSelectedAgent,
  type ContextUsageRequest,
} from '../../utils/desktopBridgeApi';
import { createPromptEnhancementPreview } from '../../utils/promptEnhancer';
import { useInputHistory } from './useInputHistory';
import type { PermissionMode } from '../../types';
import type { QueuedChatMessage } from '../../utils/abortWindowState.js';
import { buildDescriptionBlock, describeImage, isVisionActive, loadVisionConfig } from '../../utils/visionAssist';

interface ChatInputBoxProps {
  onSend: (
    text: string,
    attachments: { type: string; data: string; described?: boolean; name?: string; mediaType?: string }[],
    queue?: boolean,
    reasoningEffort?: string,
    agent?: string,
    streaming?: boolean,
    alwaysThinking?: boolean,
    modelOverride?: string,
    displayText?: string,
  ) => void;
  onContextUsage?: (request: ContextUsageRequest) => void;
  onStop: () => void;
  isStreaming: boolean;
  connected: boolean;
  mode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
  model: string;
  setModel: (model: string) => void;
  reasoning: string;
  setReasoning: (reasoning: string) => void;
  showStatusPanel: boolean;
  setShowStatusPanel: (visible: boolean) => void;
  showToolAnchors: boolean;
  setShowToolAnchors: (visible: boolean) => void;
  onProviderSwitch?: () => void;
  usageUsedTokens?: number;
  sessionKey?: string | null;
  queue: QueuedChatMessage[];
  onRemoveQueued: (id: string) => void;
  onUpdateQueued: (id: string, text: string) => void;
  onClearQueued: () => void;
}

interface FileEntry {
  name: string;
  path: string;
}

interface AgentEntry {
  id?: string;
  name: string;
  description?: string;
}

interface PromptEntry {
  name: string;
  content?: string;
  description?: string;
}

interface CommandEntry {
  name?: string;
  command?: string;
  description?: string;
}

type PromptEnhancementState = {
  originalText: string;
  localResult: string;
  aiResult: string;
  aiStatus: 'idle' | 'loading' | 'success' | 'error';
  aiError: string;
  requestId: string | null;
};

type Trigger = '@' | '#' | '!' | '/';

const PLACEHOLDER = '@引用文件，#唤起智能体，!插入提示词，Enter 发送';
const TRIGGER_CONFIGS = [
  { trigger: '@', label: 'files' },
  { trigger: '#', label: 'agents' },
  { trigger: '!', label: 'prompts' },
  { trigger: '/', label: 'commands' },
] as const;

function triggerFromText(text: string): { trigger: Trigger; query: string } | null {
  const line = text.split('\n').pop() ?? '';
  const match = line.match(/(^|\s)([@#!/])([\w\u4e00-\u9fa5.-]*)$/);
  if (!match) return null;
  return { trigger: match[2] as Trigger, query: match[3] ?? '' };
}

function replaceTrigger(text: string, trigger: Trigger, value: string) {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(^|\\s)${escaped}[\\w\\u4e00-\\u9fa5.-]*$`), `$1${value} `);
}

function readImage(file: File): Promise<{ type: string; name: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ type: 'image', name: file.name || 'pasted-image.png', data: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function shouldFocusEditor(event: MouseEvent<HTMLDivElement>) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  return !target.closest('.button-area, .context-bar, .chat-completion-dropdown, button, select, input, textarea, [role="button"]');
}

function createPromptEnhancementRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `prompt-enhancement-${Date.now()}`;
}

export function startPromptEnhancementAiRequest(current: PromptEnhancementState | null, requestId: string) {
  if (!current) return current;
  return {
    ...current,
    aiResult: '',
    aiStatus: 'loading' as const,
    aiError: '',
    requestId,
  };
}

export function resetPromptEnhancementAiState(
  current: PromptEnhancementState | null,
  aiStatus: PromptEnhancementState['aiStatus'] = 'idle',
  aiError = '',
) {
  if (!current) return current;
  return {
    ...current,
    aiResult: '',
    aiStatus,
    aiError,
    requestId: null,
  };
}

export default function ChatInputBox({
  onSend,
  onContextUsage,
  onStop,
  isStreaming,
  connected,
  mode,
  setMode,
  model,
  setModel,
  reasoning,
  setReasoning,
  showStatusPanel,
  setShowStatusPanel,
  showToolAnchors,
  setShowToolAnchors,
  onProviderSwitch,
  usageUsedTokens,
  sessionKey,
  queue,
  onRemoveQueued,
  onUpdateQueued,
  onClearQueued,
}: ChatInputBoxProps) {
  void TRIGGER_CONFIGS;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [attachments, setAttachments] = useState<{ type: string; name: string; data: string; mediaType?: string }[]>([]);
  const [selectedAgent, setSelectedAgentState] = useState(() => localStorage.getItem('selectedAgent') || '');
  const [streaming, setStreamingState] = useState(() => localStorage.getItem('streaming') !== 'false');
  const [alwaysThinking, setAlwaysThinkingState] = useState(() => localStorage.getItem('alwaysThinking') === 'true');
  const [longContextEnabled, setLongContextEnabledState] = useState(() => localStorage.getItem('longContextEnabled') !== 'false');
  const [promptEnhancement, setPromptEnhancement] = useState<PromptEnhancementState | null>(null);
  const [visionState, setVisionState] = useState<{ status: 'idle' | 'working' | 'error'; done: number; total: number; message: string }>({ status: 'idle', done: 0, total: 0, message: '' });
  const editorRef = useRef<HTMLDivElement>(null);
  const promptEnhancementRef = useRef<PromptEnhancementState | null>(null);
  const activePromptEnhancementRequestIdRef = useRef<string | null>(null);

  const getEditorText = useCallback(() => editorRef.current?.innerText ?? text, [text]);
  const syncHistoryText = useCallback(() => {
    setText(editorRef.current?.innerText ?? '');
  }, []);
  const { record: recordInputHistory, handleKeyDown: handleHistoryKeyDown } = useInputHistory({
    editableRef: editorRef,
    getTextContent: getEditorText,
    handleInput: syncHistoryText,
  });

  const activeTrigger = triggerFromText(text);
  const effectiveModel = applyLongContextSuffix(model === 'default' ? 'claude-sonnet-4-6' : model, longContextEnabled);
  const usageMaxTokens = getModelContextLimit(effectiveModel);
  const usagePercentage = calculateContextPercentage(usageUsedTokens ?? 0, usageMaxTokens);

  useEffect(() => {
    let disposed = false;
    getAgents()
      .then(data => {
        if (disposed || data.selectedAgentId === undefined) return;
        const nextAgent = data.selectedAgentId || '';
        setSelectedAgentState(nextAgent);
        localStorage.setItem('selectedAgent', nextAgent);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const setSelectedAgent = useCallback((agent: string) => {
    setSelectedAgentState(agent);
    localStorage.setItem('selectedAgent', agent);
    void persistSelectedAgent(agent || null).catch(() => {});
  }, []);

  const setStreaming = useCallback((enabled: boolean) => {
    setStreamingState(enabled);
    localStorage.setItem('streaming', String(enabled));
  }, []);

  const setAlwaysThinking = useCallback((enabled: boolean) => {
    setAlwaysThinkingState(enabled);
    localStorage.setItem('alwaysThinking', String(enabled));
  }, []);

  const setLongContextEnabled = useCallback((enabled: boolean) => {
    setLongContextEnabledState(enabled);
    localStorage.setItem('longContextEnabled', String(enabled));
  }, []);

  useEffect(() => {
    promptEnhancementRef.current = promptEnhancement;
  }, [promptEnhancement]);

  const closePromptEnhancer = useCallback(() => {
    const activeEnhancement = promptEnhancementRef.current;
    if (activeEnhancement?.aiStatus === 'loading' && activeEnhancement.requestId) {
      void cancelPromptEnhancement(activeEnhancement.requestId).catch(() => {});
    }
    activePromptEnhancementRequestIdRef.current = null;
    promptEnhancementRef.current = null;
    setPromptEnhancement(null);
  }, []);

  const openPromptEnhancer = useCallback(() => {
    const originalText = getEditorText().trim();
    if (!originalText || isStreaming) return;
    const preview = createPromptEnhancementPreview(originalText);
    setPromptEnhancement({
      originalText,
      localResult: preview.localResult,
      aiResult: '',
      aiStatus: 'idle',
      aiError: '',
      requestId: null,
    });
  }, [getEditorText, isStreaming]);

  // ccgui clears draft text and attachments when the active session changes.
  // Keeping a draft from the previous conversation is both surprising and a
  // data-leak risk when the user switches projects or history entries.
  useEffect(() => {
    closePromptEnhancer();
    setText('');
    setAttachments([]);
  }, [closePromptEnhancer, sessionKey]);

  useEffect(() => {
    if (!isStreaming) return;
    closePromptEnhancer();
  }, [closePromptEnhancer, isStreaming]);

  useEffect(() => {
    if (!activeTrigger) return;

    if (activeTrigger.trigger === '@' && files.length === 0) {
      getFileTree({ path: '.', depth: 2, showDotfiles: false })
        .then(data => {
          const collected: FileEntry[] = [];
          const walk = (nodes: unknown[]) => {
            nodes.forEach(nodeValue => {
              const node = nodeValue as { name: string; path: string; isDirectory: boolean; children?: unknown[] };
              if (!node.isDirectory) collected.push({ name: node.name, path: node.path });
              if (Array.isArray(node.children)) walk(node.children);
            });
          };
          if (Array.isArray(data.tree)) walk(data.tree);
          setFiles(collected);
        })
        .catch(() => setFiles([]));
    }

    if (activeTrigger.trigger === '#' && agents.length === 0) {
      getAgents()
        .then(data => setAgents(data.agents || []))
        .catch(() => setAgents([]));
    }

    if (activeTrigger.trigger === '!' && prompts.length === 0) {
      getPrompts()
        .then(data => setPrompts(data.prompts || []))
        .catch(() => setPrompts([]));
    }

    if (activeTrigger.trigger === '/' && commands.length === 0) {
      getCommands()
        .then(data => setCommands(data.commands || []))
        .catch(() => setCommands([]));
    }
  }, [activeTrigger, agents.length, commands.length, files.length, prompts.length]);

  const completionItems = useMemo<CompletionItem[]>(() => {
    if (!activeTrigger) return [];
    const query = activeTrigger.query.toLowerCase();
    const includesQuery = (value: string | undefined) => (value || '').toLowerCase().includes(query);

    if (activeTrigger.trigger === '@') {
      return files
        .filter(file => includesQuery(file.name) || includesQuery(file.path))
        .slice(0, 8)
        .map(file => ({ id: file.path, label: file.name, value: `@${file.path}`, description: file.path, kind: 'file' }));
    }

    if (activeTrigger.trigger === '#') {
      return agents
        .filter(agent => includesQuery(agent.name) || includesQuery(agent.description))
        .slice(0, 8)
        .map(agent => ({ id: agent.id || agent.name, label: agent.name, value: `#${agent.name}`, description: agent.description, kind: 'agent' }));
    }

    if (activeTrigger.trigger === '!') {
      return prompts
        .filter(prompt => includesQuery(prompt.name) || includesQuery(prompt.description))
        .slice(0, 8)
        .map(prompt => ({
          id: prompt.name,
          label: prompt.name,
          value: prompt.content || `!${prompt.name}`,
          description: prompt.description,
          kind: 'prompt',
        }));
    }

    return commands
      .filter(command => includesQuery(command.name || command.command) || includesQuery(command.description))
      .slice(0, 8)
      .map(command => {
        const commandText = command.command || command.name || '';
        return { id: commandText, label: commandText, value: commandText.startsWith('/') ? commandText : `/${commandText}`, description: command.description, kind: 'command' };
      });
  }, [activeTrigger, agents, commands, files, prompts]);

  const addFiles = useCallback((fileList: FileList) => {
    Array.from(fileList).forEach(file => {
      if (file.type.startsWith('image/')) {
        readImage(file).then(image => setAttachments(prev => [...prev, image])).catch(() => {});
        return;
      }
      const filePath = getPathForFile(file);
      if (!filePath) return; // web/dev 模式拿不到路径，忽略非图片
      setAttachments(prev => [...prev, {
        type: 'file',
        name: file.name || 'file',
        data: filePath,
        mediaType: file.type || undefined,
      }]);
    });
  }, []);

  const submit = useCallback(async (queue = false) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (visionState.status === 'working') return;

    let finalText = trimmed;
    let sendAttachments: { type: string; name: string; data: string; described?: boolean; mediaType?: string }[] = attachments;
    const config = loadVisionConfig();

    if (isVisionActive(config)) {
      const imageAttachments = attachments.filter(a => a.type === 'image');
      if (imageAttachments.length > 0) {
        setVisionState({ status: 'working', done: 0, total: imageAttachments.length, message: '' });
        try {
          const descriptions: string[] = [];
          for (let i = 0; i < imageAttachments.length; i += 1) {
            const description = await describeImage(config, imageAttachments[i].data);
            descriptions.push(description);
            setVisionState({ status: 'working', done: i + 1, total: imageAttachments.length, message: '' });
          }
          finalText = `${finalText}\n\n${buildDescriptionBlock(imageAttachments.map(a => a.name || ''), descriptions)}`;
          sendAttachments = sendAttachments.map(a => (a.type === 'image' ? { ...a, described: true } : a));
          setVisionState({ status: 'idle', done: 0, total: 0, message: '' });
        } catch (error) {
          setVisionState({ status: 'error', done: 0, total: imageAttachments.length, message: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
    }

    const fileAttachments = sendAttachments.filter(a => a.type === 'file');
    if (fileAttachments.length > 0) {
      finalText = `${finalText}\n\n${fileAttachments.map(a => `[文件 ${a.name}]\n${a.data}`).join('\n\n')}`;
      sendAttachments = sendAttachments.map(a => (a.type === 'file' ? { ...a, described: true } : a));
    }

    recordInputHistory(text);
    if (attachments.length === 0 && /^\/context(?:\s|$)/i.test(finalText)) {
      onContextUsage?.({
        model: effectiveModel,
        mode,
        reasoning,
        agent: selectedAgent || undefined,
        streaming,
        alwaysThinking,
      });
      setText('');
      return;
    }
    onSend(
      finalText,
      sendAttachments.map(attachment => ({ type: attachment.type, data: attachment.data, described: attachment.described, name: attachment.name, mediaType: attachment.mediaType })),
      queue,
      reasoning,
      selectedAgent,
      streaming,
      alwaysThinking,
      applyLongContextSuffix(model === 'default' ? 'claude-sonnet-4-6' : model, longContextEnabled),
      trimmed,
    );
    setText('');
    setAttachments([]);
  }, [alwaysThinking, attachments, effectiveModel, longContextEnabled, model, onContextUsage, onSend, reasoning, recordInputHistory, selectedAgent, streaming, text, visionState.status]);

  const selectCompletion = (item: CompletionItem) => {
    if (!activeTrigger) return;
    setText(prev => replaceTrigger(prev, activeTrigger.trigger, item.value));
    if (item.kind === 'agent') setSelectedAgent(item.id);
  };

  return (
    <div
      className="chat-input-box"
      onClick={event => {
        if (shouldFocusEditor(event)) {
          document.querySelector<HTMLElement>('.input-editable')?.focus();
        }
      }}
    >
      {visionState.status === 'working' && (
        <div className="vision-status-bar working">
          <Loader2 size={13} className="vision-spin" /> 正在识别图片 ({visionState.done}/{visionState.total})…
        </div>
      )}
      {visionState.status === 'error' && (
        <div className="vision-status-bar error">
          <span className="vision-status-message">视觉模型调用失败：{visionState.message}</span>
          <button type="button" onClick={() => void submit(false)}>重试</button>
          <button type="button" className="ghost" onClick={() => {
            setVisionState({ status: 'idle', done: 0, total: 0, message: '' });
            const trimmed = text.trim();
            recordInputHistory(text);
            onSend(
              trimmed,
              [],
              false,
              reasoning,
              selectedAgent,
              streaming,
              alwaysThinking,
              applyLongContextSuffix(model === 'default' ? 'claude-sonnet-4-6' : model, longContextEnabled),
            );
            setText('');
            setAttachments([]);
          }}>跳过图片发送</button>
        </div>
      )}
      <ContextBar
        attachments={attachments}
        percentage={usagePercentage}
        usedTokens={usageUsedTokens}
        maxTokens={usageMaxTokens}
        showStatusPanel={showStatusPanel}
        onToggleStatusPanel={() => {
          const next = !showStatusPanel;
          setShowStatusPanel(next);
          localStorage.setItem('showStatusPanel', String(next));
        }}
        onPickFiles={addFiles}
        onRemoveAttachment={index => setAttachments(prev => prev.filter((_, itemIndex) => itemIndex !== index))}
        queue={queue}
        onRemoveQueued={onRemoveQueued}
        onUpdateQueued={onUpdateQueued}
        onClearQueued={onClearQueued}
      />

      <InputEditable
        value={text}
        placeholder={PLACEHOLDER}
        onChange={setText}
        editorRef={editorRef}
        onHistoryKeyDown={handleHistoryKeyDown}
        onSubmit={() => submit(false)}
        onPasteImage={file => {
          readImage(file).then(image => setAttachments(prev => [...prev, image])).catch(() => {});
        }}
        onDropFiles={addFiles}
      />

      <CompletionDropdown items={completionItems} onSelect={selectCompletion} />

      <ButtonArea
        hasInputContent={!!text.trim() || attachments.length > 0}
        hasPromptText={!!text.trim()}
        isStreaming={isStreaming}
        mode={mode}
        setMode={setMode}
        model={model}
        setModel={setModel}
        reasoning={reasoning}
        setReasoning={setReasoning}
        selectedAgent={selectedAgent}
        setSelectedAgent={setSelectedAgent}
        streaming={streaming}
        setStreaming={setStreaming}
        alwaysThinking={alwaysThinking}
        setAlwaysThinking={setAlwaysThinking}
        longContextEnabled={longContextEnabled}
        setLongContextEnabled={setLongContextEnabled}
        showToolAnchors={showToolAnchors}
        setShowToolAnchors={setShowToolAnchors}
        onProviderSwitch={onProviderSwitch}
        onSubmit={submit}
        onEnhancePrompt={openPromptEnhancer}
        onStop={onStop}
      />

      {promptEnhancement ? (
        <PromptEnhanceDialog
          originalText={promptEnhancement.originalText}
          localResult={promptEnhancement.localResult}
          aiResult={promptEnhancement.aiResult}
          aiStatus={promptEnhancement.aiStatus}
          aiError={promptEnhancement.aiError}
          onUse={(nextText) => {
            setText(nextText);
            closePromptEnhancer();
          }}
          onRestore={() => {
            setText(promptEnhancement.originalText);
            closePromptEnhancer();
          }}
          onCancel={closePromptEnhancer}
          onCancelAi={() => {
            if (promptEnhancement.requestId) {
              void cancelPromptEnhancement(promptEnhancement.requestId).catch(() => {});
            }
            activePromptEnhancementRequestIdRef.current = null;
            setPromptEnhancement(current => resetPromptEnhancementAiState(current));
          }}
          onAiEnhance={async () => {
            if (promptEnhancement.aiStatus === 'loading') return;

            const requestId = createPromptEnhancementRequestId();
            activePromptEnhancementRequestIdRef.current = requestId;
            setPromptEnhancement(current => startPromptEnhancementAiRequest(current, requestId));

            try {
              const result = await enhancePrompt({
                requestId,
                text: promptEnhancement.originalText,
                localResult: promptEnhancement.localResult,
              });

              if (activePromptEnhancementRequestIdRef.current !== result.requestId) return;

              setPromptEnhancement(current => {
                if (!current || current.requestId !== result.requestId) return current;
                activePromptEnhancementRequestIdRef.current = null;
                return {
                  ...current,
                  aiResult: result.text,
                  aiStatus: 'success',
                  aiError: '',
                };
              });
            } catch (error) {
              if (activePromptEnhancementRequestIdRef.current !== requestId) return;
              activePromptEnhancementRequestIdRef.current = null;

              setPromptEnhancement(current => (
                current && current.requestId === requestId
                  ? resetPromptEnhancementAiState(current, 'error', error instanceof Error ? error.message : String(error))
                  : current
              ));
            }
          }}
        />
      ) : null}

      {!connected && <div className="connection-status">连接断开，重连中...</div>}
    </div>
  );
}
