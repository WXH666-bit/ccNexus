import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, Paperclip, AtSign, Slash, Sparkles, ListOrdered, ChevronDown, Layers } from 'lucide-react';
import type { Session } from '../types';
import ProviderSelect from './ProviderSelect';
import ReasoningSelect from './ReasoningSelect';
import ConfigSelect from './ConfigSelect';

interface ChatInputBoxProps {
  onSend: (text: string, attachments: { type: string; data: string }[], queue?: boolean, reasoningEffort?: string, agent?: string, streaming?: boolean, alwaysThinking?: boolean) => void;
  onStop: () => void;
  isStreaming: boolean;
  connected: boolean;
  mode: string;
  setMode: (m: string) => void;
  model: string;
  setModel: (m: string) => void;
  reasoning: string;
  setReasoning: (r: string) => void;
  showStatusPanel: boolean;
  setShowStatusPanel: (v: boolean) => void;
}

const MODES = [
  { value: 'default', label: '默认模式' },
  { value: 'plan', label: '计划模式' },
  { value: 'acceptEdits', label: '接受编辑' },
  { value: 'bypassPermissions', label: '自动模式' },
];

const MODELS = [
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-fable-5', name: 'Claude Fable 5' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
];

// 思考深度档位定义
const REASONING_LEVELS = [
  { value: 'low', label: '低', icon: '🔋', desc: '快速响应，较少思考' },
  { value: 'medium', label: '中', icon: '⚡', desc: '平衡速度与深度' },
  { value: 'high', label: '高', icon: '🔥', desc: '深度思考，推荐' },
  { value: 'xhigh', label: '超高', icon: '💎', desc: '极深思考，耗时较长' },
  { value: 'max', label: '最大', icon: '🚀', desc: '最大思考，最慢但最全面' },
];

// 支持 effort 的模型集合
const EFFORT_SUPPORTED_CLAUDE_MODELS = new Set([
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-fable-5',
]);

// 支持 xhigh 档位的模型集合
const XHIGH_EFFORT_CLAUDE_MODELS = new Set([
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-6',
]);

// 支持 max 档位的模型集合
const MAX_EFFORT_CLAUDE_MODELS = new Set([
  'claude-opus-4-8',
  'claude-opus-4-6',
]);

export default function ChatInputBox({
  onSend, onStop, isStreaming, connected,
  mode, setMode, model, setModel, reasoning, setReasoning,
  showStatusPanel, setShowStatusPanel,
}: ChatInputBoxProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const [files, setFiles] = useState<{ name: string; path: string }[]>([]);
  const [attachments, setAttachments] = useState<{ type: string; name: string; data: string }[]>([]);
  const [reasoningEffort, setReasoningEffort] = useState('high');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tokenUsage] = useState(26);
  
  // Config menu state
  const [selectedAgent, setSelectedAgent] = useState(() => localStorage.getItem('selectedAgent') || '');
  const [streaming, setStreaming] = useState(() => {
    const saved = localStorage.getItem('streaming');
    return saved !== null ? saved === 'true' : true;
  });
  const [alwaysThinking, setAlwaysThinking] = useState(() => {
    const saved = localStorage.getItem('alwaysThinking');
    return saved !== null ? saved === 'true' : false;
  });
  
  // Persist config changes
  useEffect(() => {
    localStorage.setItem('selectedAgent', selectedAgent);
  }, [selectedAgent]);
  
  useEffect(() => {
    localStorage.setItem('streaming', String(streaming));
  }, [streaming]);
  
  useEffect(() => {
    localStorage.setItem('alwaysThinking', String(alwaysThinking));
  }, [alwaysThinking]);

  // Fetch file list for @ completion
  useEffect(() => {
    if (showAtMenu) {
      fetch(`/api/files/tree?path=.&depth=2&showDotfiles=false`)
        .then(r => r.json())
        .then(data => {
          const allFiles: { name: string; path: string }[] = [];
          function walk(nodes: unknown[]) {
            nodes.forEach((n: unknown) => {
              const node = n as { name: string; path: string; isDirectory: boolean; children?: unknown[] };
              if (!node.isDirectory) allFiles.push({ name: node.name, path: node.path });
              if (node.children) walk(node.children);
            });
          }
          if (Array.isArray(data)) walk(data);
          setFiles(allFiles);
        })
        .catch(() => setFiles([]));
    }
  }, [showAtMenu]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [text, attachments]);

  const handleSubmit = (queue: boolean = false) => {
    if (!text.trim() && attachments.length === 0) return;
    onSend(text, attachments.map(a => ({ type: a.type, data: a.data })), queue, reasoningEffort, selectedAgent, streaming, alwaysThinking);
    setText('');
    setAttachments([]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            setAttachments(prev => [...prev, { type: 'image', name: file.name || 'pasted-image.png', data: reader.result as string }]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 8);
  const slashCommands = [
    { cmd: '/init', desc: '初始化项目' },
    { cmd: '/review', desc: '代码审查' },
    { cmd: '/test', desc: '运行测试' },
    { cmd: '/fix', desc: '修复问题' },
  ];

  return (
    <div className="chat-input-box">
      {/* Context bar - attachments */}
      {attachments.length > 0 && (
        <div className="context-bar">
          {attachments.map((a, i) => (
            <span key={i} className="attachment-chip">
              {a.type === 'image' ? '🖼' : '📎'} {a.name}
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Token indicator + Status panel toggle */}
      <div className="context-bar-row">
        <div className="token-indicator" title="上下文用量">
          <span className="token-ring">{tokenUsage}%</span>
          <span className="token-label">文件上下文</span>
        </div>
        <button 
          className="status-toggle-btn"
          onClick={() => {
            const newValue = !showStatusPanel;
            setShowStatusPanel(newValue);
            localStorage.setItem('showStatusPanel', String(newValue));
          }}
          title={showStatusPanel ? t('status.collapse') : t('status.expand')}
        >
          {showStatusPanel ? <ChevronDown size={16} /> : <Layers size={16} />}
        </button>
      </div>

      {/* Input area */}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={text}
          onChange={e => {
            setText(e.target.value);
            const val = e.target.value;
            const atMatch = val.match(/@(\w*)$/);
            const slashMatch = val.match(/\/(\w*)$/);
            setShowAtMenu(!!atMatch);
            setAtQuery(atMatch?.[1] || '');
            setShowSlashMenu(!!slashMatch && (val.split('\n').pop()?.startsWith('/') ?? false));
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="@引用文件，/斜杠命令，Enter 发送"
          rows={1}
        />
      </div>

      {/* @ file completion dropdown */}
      {showAtMenu && filteredFiles.length > 0 && (
        <div className="completion-dropdown">
          {filteredFiles.map(f => (
            <div
              key={f.path}
              className="dropdown-item"
              onClick={() => {
                setText(prev => prev.replace(/@\w*$/, `@${f.name} `));
                setShowAtMenu(false);
              }}
            >
              <AtSign size={14} />
              <span>{f.path}</span>
            </div>
          ))}
        </div>
      )}

      {/* / slash command dropdown */}
      {showSlashMenu && (
        <div className="completion-dropdown">
          {slashCommands.filter(c => c.cmd.startsWith(text.split('\n').pop() || '')).map(c => (
            <div
              key={c.cmd}
              className="dropdown-item"
              onClick={() => {
                setText(prev => {
                  const lines = prev.split('\n');
                  lines[lines.length - 1] = c.cmd + ' ';
                  return lines.join('\n');
                });
                setShowSlashMenu(false);
              }}
            >
              <Slash size={14} />
              <span>{c.cmd}</span>
              <span className="dropdown-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom selectors row */}
      <div className="input-bottom-row">
        <div className="input-left-actions">
          <ConfigSelect
            selectedAgent={selectedAgent}
            onAgentChange={setSelectedAgent}
            streaming={streaming}
            onStreamingChange={setStreaming}
            alwaysThinking={alwaysThinking}
            onAlwaysThinkingChange={setAlwaysThinking}
          />
          <button className="action-btn" title="附件"><Paperclip size={16} /></button>
        </div>
        <div className="input-selectors">
          <ProviderSelect />
          <select className="selector" value={mode} onChange={e => setMode(e.target.value)}>
            {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select className="selector" value={model} onChange={e => setModel(e.target.value)}>
            <option value="default">default</option>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <ReasoningSelect
            value={reasoningEffort}
            onChange={setReasoningEffort}
            currentModel={model}
            effortSupportedModels={EFFORT_SUPPORTED_CLAUDE_MODELS}
            xhighEffortModels={XHIGH_EFFORT_CLAUDE_MODELS}
            maxEffortModels={MAX_EFFORT_CLAUDE_MODELS}
          />
        </div>
        <div className="input-right-actions">
          <button className="action-btn enhance-btn" title="提示词增强"><Sparkles size={16} /></button>
          {isStreaming ? (
            <>
              <button
                className="action-btn queue-btn"
                onClick={() => handleSubmit(true)}
                disabled={!text.trim() && attachments.length === 0}
                title={t('chat.input.queue')}
              >
                <ListOrdered size={16} />
              </button>
              <button className="send-btn stop-btn" onClick={onStop} title="停止">
                <Square size={16} />
              </button>
            </>
          ) : (
            <button
              className="send-btn"
              onClick={() => handleSubmit(false)}
              disabled={!text.trim() && attachments.length === 0}
              title="发送"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      {!connected && <div className="connection-status">连接断开，重连中...</div>}
    </div>
  );
}
