import { useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { ChatMessage, ContentBlock, SubAgentInfo, ToolResultBlock, ToolUseBlock } from '../types';
import EditToolBlock from './toolBlocks/EditToolBlock';
import BashToolBlock from './toolBlocks/BashToolBlock';
import ReadToolBlock from './toolBlocks/ReadToolBlock';
import GenericToolBlock from './toolBlocks/GenericToolBlock';
import TaskBlock from './toolBlocks/TaskBlock';
import AgentGroupBlock from './toolBlocks/AgentGroupBlock';
import ToolGroupBlock from './toolBlocks/ToolGroupBlock';
import AskUserQuestionCard from './AskUserQuestionCard';
import CollapsibleBlock from './CollapsibleBlock';
import { renderMarkdown } from '../utils/markdown';
import {
  AGENT_TOOL_NAMES,
  BASH_TOOL_NAMES,
  EDIT_TOOL_NAMES,
  READ_TOOL_NAMES,
  groupBlocks,
  isToolName,
  shouldRenderToolUse,
} from '../utils/toolRendering.js';

interface SearchHighlight {
  query: string;
  currentMatchId?: string;
  totalMatches: number;
  currentMatchIndex: number;
}

interface MessageItemProps {
  message: ChatMessage;
  messageIndex?: number;
  isLast?: boolean;
  searchHighlight?: SearchHighlight;
  onRewind?: (messageId: string) => void;
  findToolResult?: (toolId: string | undefined, messageIndex: number) => ToolResultBlock | null;
}

function highlightText(text: string, query: string, isCurrentMatch: boolean): string {
  if (!query) return text;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const className = isCurrentMatch ? 'search-highlight-current' : 'search-highlight';
  return text.replace(regex, `<mark class="${className}">$1</mark>`);
}

function textFromMessage(message: ChatMessage): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

function ToolCard({
  block,
  result,
  isStreaming,
}: {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
  isStreaming: boolean;
}) {
  if (!shouldRenderToolUse(block.name, isStreaming)) return null;

  if (isToolName(block.name, EDIT_TOOL_NAMES)) return <EditToolBlock block={block} result={result} />;
  if (isToolName(block.name, BASH_TOOL_NAMES)) return <BashToolBlock block={block} result={result} />;
  if (isToolName(block.name, READ_TOOL_NAMES)) return <ReadToolBlock block={block} result={result} />;
  if (isToolName(block.name, AGENT_TOOL_NAMES)) return <TaskBlock block={block} result={result} />;

  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionCard question={{
      question_id: block.id,
      question: (block.input.question as string) || '',
      options: block.input.options as string[] | undefined,
      context: block.input.context as string | undefined,
      tool_use_id: block.id,
    }} onAnswer={() => {}} />;
  }

  return <GenericToolBlock block={block} result={result} />;
}

function CompactSummary({ block }: { block: Extract<ContentBlock, { type: 'compact_summary' }> }) {
  const meta = block.metadata;
  const stats = [
    meta?.trigger,
    typeof meta?.messagesSummarized === 'number' ? `${meta.messagesSummarized} messages` : '',
    typeof meta?.preTokens === 'number' && typeof meta?.postTokens === 'number'
      ? `${meta.preTokens} -> ${meta.postTokens} tokens`
      : '',
  ].filter(Boolean).join(' · ');

  return (
    <CollapsibleBlock title={block.title || 'Compact summary'} defaultOpen={false}>
      {stats && <div className="compact-summary-metadata">{stats}</div>}
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content || '') }} />
    </CollapsibleBlock>
  );
}

function agentInfoFromBlock(block: ToolUseBlock, status: SubAgentInfo['status']): SubAgentInfo {
  const description = (block.input.description as string) || (block.input.prompt as string) || block.name;
  return {
    id: block.id,
    name: block.name,
    status,
    description,
    toolUseId: block.id,
  };
}

export default function MessageItem({
  message,
  messageIndex = 0,
  isLast = false,
  searchHighlight,
  onRewind,
  findToolResult,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const isCurrentSearchMatch = searchHighlight?.currentMatchId === message.id;

  const getResult = (toolId: string | undefined) => findToolResult?.(toolId, messageIndex) ?? null;

  if (message.role === 'user') {
    const displayText = textFromMessage(message);
    const highlightedText = searchHighlight?.query
      ? highlightText(displayText, searchHighlight.query, isCurrentSearchMatch)
      : displayText;

    return (
      <div className={`message-row user-row ${isCurrentSearchMatch ? 'search-match' : ''}`} id={`msg-${message.id}`}>
        <div className="message-bubble user-bubble">
          <span className="message-text" dangerouslySetInnerHTML={{ __html: highlightedText }} />
          <span className="message-time">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(displayText); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        {onRewind && (
          <button className="rewind-btn" onClick={() => onRewind(message.id)} title="Rewind to this message">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  if (message.role === 'system') {
    const text = textFromMessage(message);
    return (
      <div className="message-row system-row" id={`msg-${message.id}`}>
        <div className="system-message">{text}</div>
      </div>
    );
  }

  const groupedBlocks = groupBlocks(message.content);
  const isMessageStreaming = Boolean(message.isStreaming && isLast);

  return (
    <div className={`message-row assistant-row ${isCurrentSearchMatch ? 'search-match' : ''}`} id={`msg-${message.id}`}>
      <div className="message-content">
        {groupedBlocks.map((grouped, idx) => {
          if (grouped.type === 'read_group' || grouped.type === 'edit_group' || grouped.type === 'bash_group' || grouped.type === 'search_group') {
            if (grouped.blocks.length === 1) {
              const block = grouped.blocks[0];
              return (
                <ToolCard
                  key={`${message.id}-${grouped.type}-${grouped.startIndex}`}
                  block={block}
                  result={getResult(block.id)}
                  isStreaming={isMessageStreaming}
                />
              );
            }
            return (
              <ToolGroupBlock
                key={`${message.id}-${grouped.type}-${grouped.startIndex}`}
                name={grouped.blocks[0].name}
                blocks={grouped.blocks}
                getResult={getResult}
              />
            );
          }

          if (grouped.type === 'agent_group') {
            const agentResult = getResult(grouped.agentBlock.id);
            const agents = [
              agentInfoFromBlock(grouped.agentBlock, agentResult ? (agentResult.is_error ? 'error' : 'completed') : 'running'),
              ...grouped.followingBlocks.map(block => {
                const result = getResult(block.id);
                return agentInfoFromBlock(block, result ? (result.is_error ? 'error' : 'completed') : 'running');
              }),
            ];
            return (
              <AgentGroupBlock
                key={`${message.id}-agent-${grouped.startIndex}`}
                agents={agents}
                title={(grouped.agentBlock.input.description as string) || 'Subtasks'}
              />
            );
          }

          const block = grouped.block;

          if (block.type === 'text') {
            if (!block.text.trim() && message.isStreaming) return null;
            const rendered = renderMarkdown(block.text);
            const highlighted = searchHighlight?.query
              ? highlightText(rendered, searchHighlight.query, isCurrentSearchMatch)
              : rendered;
            return <div key={idx} className="markdown-body" dangerouslySetInnerHTML={{ __html: highlighted }} />;
          }

          if (block.type === 'thinking') {
            const isLastBlock = idx === groupedBlocks.length - 1;
            return (
              <CollapsibleBlock key={idx} title={isMessageStreaming && isLastBlock ? 'Thinking process' : 'Thinking'} defaultOpen={isMessageStreaming && isLastBlock}>
                <div className="thinking-content">{block.thinking}</div>
              </CollapsibleBlock>
            );
          }

          if (block.type === 'tool_result') return null;

          if (block.type === 'tool_use') {
            return <ToolCard key={idx} block={block} result={getResult(block.id)} isStreaming={isMessageStreaming} />;
          }

          if (block.type === 'image') {
            return (
              <button key={idx} type="button" className="message-image-block" onClick={() => window.open(block.src, '_blank')} title="Open image">
                <img src={block.src} alt={block.alt || 'Uploaded image'} />
              </button>
            );
          }

          if (block.type === 'attachment') {
            return (
              <div key={idx} className="message-attachment-chip" title={block.fileName || 'Attachment'}>
                <span className="message-attachment-chip-ext">{block.mediaType || 'file'}</span>
                <span className="message-attachment-chip-name">{block.fileName || 'Attachment'}</span>
              </div>
            );
          }

          if (block.type === 'compact_notification') {
            return (
              <div key={idx} className="compact-notification-block">
                <div className="compact-notification-header">{block.headerText}</div>
                {block.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="compact-notification-item">
                    <span className="compact-notification-prefix">-</span>
                    <span className="compact-notification-text">{item.text}</span>
                  </div>
                ))}
              </div>
            );
          }

          if (block.type === 'compact_summary') {
            return <CompactSummary key={idx} block={block} />;
          }

          if (block.type === 'task_notification') {
            return (
              <div key={idx} className={`task-notification-block task-notification-${block.status}`}>
                <span className="task-notification-icon">{block.icon}</span>
                <span className="task-notification-summary">
                  {block.summary}
                  {block.detail && <span className="task-notification-detail" title={block.detail}>{block.detail.slice(0, 300)}</span>}
                </span>
              </div>
            );
          }

          return null;
        })}
        {message.isStreaming && <span className="streaming-cursor">▌</span>}
      </div>
      <button className="copy-btn copy-msg-btn" onClick={() => {
        const text = textFromMessage(message);
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {onRewind && (
        <button className="rewind-btn" onClick={() => onRewind(message.id)} title="Rewind to this message">
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}
