import { useState } from 'react';
import { Copy, Check, RotateCcw } from 'lucide-react';
import type { ChatMessage, ContentBlock, ToolUseBlock } from '../types';
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

interface SearchHighlight {
  query: string;
  currentMatchId?: string;
  totalMatches: number;
  currentMatchIndex: number;
}

interface MessageItemProps {
  message: ChatMessage;
  messageIndex?: number;
  searchHighlight?: SearchHighlight;
  onRewind?: (messageId: string) => void;
}

function highlightText(text: string, query: string, isCurrentMatch: boolean): string {
  if (!query) return text;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const className = isCurrentMatch ? 'search-highlight-current' : 'search-highlight';
  return text.replace(regex, `<mark class="${className}">$1</mark>`);
}

function ToolCard({ block }: { block: ToolUseBlock }) {
  const name = block.name;
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return <EditToolBlock block={block} />;
    case 'Bash':
      return <BashToolBlock block={block} />;
    case 'Read':
    case 'ReadFile':
      return <ReadToolBlock block={block} />;
    case 'Task':
    case 'Agent':
      return <TaskBlock block={block} />;
    case 'AskUserQuestion':
      return <AskUserQuestionCard question={{
        question_id: block.id,
        question: (block.input.question as string) || '',
        options: block.input.options as string[] | undefined,
        context: block.input.context as string | undefined,
        tool_use_id: block.id,
      }} onAnswer={() => {}} />;
    default:
      return <GenericToolBlock block={block} />;
  }
}

function groupConsecutiveTools(blocks: ContentBlock[]): (ContentBlock | { type: 'group'; name: string; blocks: ToolUseBlock[] })[] {
  const result: (ContentBlock | { type: 'group'; name: string; blocks: ToolUseBlock[] })[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'tool_use') {
      const name = block.name;
      const group: ToolUseBlock[] = [block];
      let j = i + 1;
      while (j < blocks.length && blocks[j].type === 'tool_use' && (blocks[j] as ToolUseBlock).name === name) {
        group.push(blocks[j] as ToolUseBlock);
        j++;
      }
      if (group.length >= 2) {
        result.push({ type: 'group', name, blocks: group });
        i = j;
      } else {
        result.push(block);
        i++;
      }
    } else {
      result.push(block);
      i++;
    }
  }
  return result;
}

export default function MessageItem({ message, messageIndex, searchHighlight, onRewind }: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const isCurrentSearchMatch = searchHighlight?.currentMatchId === message.id;

  if (message.role === 'user') {
    const text = message.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
    const displayText = text?.text || '';
    const highlightedText = searchHighlight?.query 
      ? highlightText(displayText, searchHighlight.query, isCurrentSearchMatch)
      : displayText;

    return (
      <div 
        className={`message-row user-row ${isCurrentSearchMatch ? 'search-match' : ''}`}
        id={`msg-${message.id}`}
      >
        <div className="message-bubble user-bubble">
          <span className="message-text" dangerouslySetInnerHTML={{ __html: highlightedText }} />
          <span className="message-time">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(displayText); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        {onRewind && (
          <button className="rewind-btn" onClick={() => onRewind(message.id)} title="回溯到此消息">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  if (message.role === 'system') {
    const text = message.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
    return (
      <div className="message-row system-row" id={`msg-${message.id}`}>
        <div className="system-message">{text?.text || ''}</div>
      </div>
    );
  }

  // Assistant message
  const groupedBlocks = groupConsecutiveTools(message.content);

  return (
    <div 
      className={`message-row assistant-row ${isCurrentSearchMatch ? 'search-match' : ''}`}
      id={`msg-${message.id}`}
    >
      <div className="message-content">
        {groupedBlocks.map((block, idx) => {
          if (block.type === 'text') {
            const text = (block as { type: 'text'; text: string }).text;
            if (!text.trim() && message.isStreaming) return null;
            const rendered = renderMarkdown(text);
            const highlighted = searchHighlight?.query 
              ? highlightText(rendered, searchHighlight.query, isCurrentSearchMatch)
              : rendered;
            return <div key={idx} className="markdown-body" dangerouslySetInnerHTML={{ __html: highlighted }} />;
          }
          if (block.type === 'thinking') {
            const tb = block as { type: 'thinking'; thinking: string };
            return (
              <CollapsibleBlock key={idx} title="思考" defaultOpen={false}>
                <div className="thinking-content">{tb.thinking}</div>
              </CollapsibleBlock>
            );
          }
          if (block.type === 'tool_result') return null;
          if ('type' in block && (block as Record<string, unknown>).type === 'group') {
            const g = block as { type: 'group'; name: string; blocks: ToolUseBlock[] };
            if (g.name === 'Task' || g.name === 'Agent') {
              return <AgentGroupBlock key={idx} agents={g.blocks.map(b => ({
                id: b.id,
                name: b.name,
                status: 'completed' as const,
                description: (b.input.description as string) || (b.input.prompt as string) || '',
              }))} />;
            }
            return <ToolGroupBlock key={idx} name={g.name} blocks={g.blocks} />;
          }
          if (block.type === 'tool_use') {
            return <ToolCard key={idx} block={block as ToolUseBlock} />;
          }
          return null;
        })}
        {message.isStreaming && (
          <span className="streaming-cursor">▌</span>
        )}
      </div>
      <button className="copy-btn copy-msg-btn" onClick={() => {
        const text = message.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('\n');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {onRewind && (
        <button className="rewind-btn" onClick={() => onRewind(message.id)} title="回溯到此消息">
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}
