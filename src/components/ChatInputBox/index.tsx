import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import ContextBar from './ContextBar';
import InputEditable from './InputEditable';
import CompletionDropdown, { type CompletionItem } from './CompletionDropdown';
import ButtonArea from './ButtonArea';
import { applyLongContextSuffix } from '../../utils/modelResolution';
import { calculateContextPercentage, getModelContextLimit } from '../../utils/contextUsage';

interface ChatInputBoxProps {
  onSend: (
    text: string,
    attachments: { type: string; data: string }[],
    queue?: boolean,
    reasoningEffort?: string,
    agent?: string,
    streaming?: boolean,
    alwaysThinking?: boolean,
    modelOverride?: string,
  ) => void;
  onStop: () => void;
  isStreaming: boolean;
  connected: boolean;
  mode: string;
  setMode: (mode: string) => void;
  model: string;
  setModel: (model: string) => void;
  reasoning: string;
  setReasoning: (reasoning: string) => void;
  showStatusPanel: boolean;
  setShowStatusPanel: (visible: boolean) => void;
  showToolAnchors: boolean;
  setShowToolAnchors: (visible: boolean) => void;
  usageUsedTokens?: number;
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

export default function ChatInputBox({
  onSend,
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
  usageUsedTokens,
}: ChatInputBoxProps) {
  void TRIGGER_CONFIGS;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [attachments, setAttachments] = useState<{ type: string; name: string; data: string }[]>([]);
  const [selectedAgent, setSelectedAgent] = useState(() => localStorage.getItem('selectedAgent') || '');
  const [streaming, setStreaming] = useState(() => localStorage.getItem('streaming') !== 'false');
  const [alwaysThinking, setAlwaysThinking] = useState(() => localStorage.getItem('alwaysThinking') === 'true');
  const [longContextEnabled, setLongContextEnabled] = useState(() => localStorage.getItem('longContextEnabled') !== 'false');

  const activeTrigger = triggerFromText(text);
  const effectiveModel = applyLongContextSuffix(model === 'default' ? 'claude-sonnet-4-6' : model, longContextEnabled);
  const usageMaxTokens = getModelContextLimit(effectiveModel);
  const usagePercentage = calculateContextPercentage(usageUsedTokens ?? 0, usageMaxTokens);

  useEffect(() => localStorage.setItem('selectedAgent', selectedAgent), [selectedAgent]);
  useEffect(() => localStorage.setItem('streaming', String(streaming)), [streaming]);
  useEffect(() => localStorage.setItem('alwaysThinking', String(alwaysThinking)), [alwaysThinking]);
  useEffect(() => localStorage.setItem('longContextEnabled', String(longContextEnabled)), [longContextEnabled]);

  useEffect(() => {
    if (!activeTrigger) return;

    if (activeTrigger.trigger === '@' && files.length === 0) {
      fetch('/api/files/tree?path=.&depth=2&showDotfiles=false')
        .then(response => response.json())
        .then(data => {
          const collected: FileEntry[] = [];
          const walk = (nodes: unknown[]) => {
            nodes.forEach(nodeValue => {
              const node = nodeValue as { name: string; path: string; isDirectory: boolean; children?: unknown[] };
              if (!node.isDirectory) collected.push({ name: node.name, path: node.path });
              if (Array.isArray(node.children)) walk(node.children);
            });
          };
          if (Array.isArray(data)) walk(data);
          setFiles(collected);
        })
        .catch(() => setFiles([]));
    }

    if (activeTrigger.trigger === '#' && agents.length === 0) {
      fetch('/api/agents')
        .then(response => response.json())
        .then(data => setAgents(data.agents || []))
        .catch(() => setAgents([]));
    }

    if (activeTrigger.trigger === '!' && prompts.length === 0) {
      fetch('/api/prompts')
        .then(response => response.json())
        .then(data => setPrompts(data.prompts || []))
        .catch(() => setPrompts([]));
    }

    if (activeTrigger.trigger === '/' && commands.length === 0) {
      fetch('/api/commands')
        .then(response => response.json())
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
        .map(file => ({ id: file.path, label: file.name, value: `@${file.name}`, description: file.path, kind: 'file' }));
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
      if (!file.type.startsWith('image/')) return;
      readImage(file).then(image => setAttachments(prev => [...prev, image])).catch(() => {});
    });
  }, []);

  const submit = useCallback((queue = false) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(
      trimmed,
      attachments.map(attachment => ({ type: attachment.type, data: attachment.data })),
      queue,
      reasoning,
      selectedAgent,
      streaming,
      alwaysThinking,
      applyLongContextSuffix(model === 'default' ? 'claude-sonnet-4-6' : model, longContextEnabled),
    );
    setText('');
    setAttachments([]);
  }, [alwaysThinking, attachments, longContextEnabled, model, onSend, reasoning, selectedAgent, streaming, text]);

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
      />

      <InputEditable
        value={text}
        placeholder={PLACEHOLDER}
        onChange={setText}
        onSubmit={() => submit(false)}
        onPasteImage={file => {
          readImage(file).then(image => setAttachments(prev => [...prev, image])).catch(() => {});
        }}
      />

      <CompletionDropdown items={completionItems} onSelect={selectCompletion} />

      <ButtonArea
        hasInputContent={!!text.trim() || attachments.length > 0}
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
        onSubmit={submit}
        onStop={onStop}
      />

      {!connected && <div className="connection-status">连接断开，重连中...</div>}
    </div>
  );
}
