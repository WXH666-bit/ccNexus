import { useMemo, useState } from 'react';
import { MessageSquare, Bot, User, Code, Lightbulb, Info } from 'lucide-react';
import type { ChatMessage, MessageAnchor } from '../types';

interface Props {
  messages: ChatMessage[];
  onAnchorClick: (messageId: string) => void;
}

function getAnchors(messages: ChatMessage[]): MessageAnchor[] {
  const anchors: MessageAnchor[] = [];
  
  messages.forEach((msg, idx) => {
    if (msg.role === 'user') {
      const text = msg.content.find(b => b.type === 'text');
      const label = text ? (text as { type: 'text'; text: string }).text.slice(0, 30) : '用户消息';
      anchors.push({
        messageId: msg.id,
        label,
        timestamp: msg.timestamp,
        role: 'user',
        kind: 'user_message',
      });
    } else if (msg.role === 'assistant') {
      // Add anchor for first text block
      const textBlock = msg.content.find(b => b.type === 'text');
      if (textBlock) {
        const text = (textBlock as { type: 'text'; text: string }).text;
        const label = text.slice(0, 30) || '助手回复';
        anchors.push({
          messageId: msg.id,
          label,
          timestamp: msg.timestamp,
          role: 'assistant',
          kind: 'assistant_text',
        });
      }
      
      // Add anchors for tool calls
      msg.content.forEach(block => {
        if (block.type === 'tool_use') {
          const toolBlock = block as { type: 'tool_use'; name: string; id: string };
          anchors.push({
            messageId: msg.id,
            label: `${toolBlock.name}`,
            timestamp: msg.timestamp,
            role: 'assistant',
            kind: 'tool_call',
          });
        } else if (block.type === 'thinking') {
          anchors.push({
            messageId: msg.id,
            label: '思考过程',
            timestamp: msg.timestamp,
            role: 'assistant',
            kind: 'thinking',
          });
        }
      });
    } else if (msg.role === 'system') {
      const text = msg.content.find(b => b.type === 'text');
      const label = text ? (text as { type: 'text'; text: string }).text.slice(0, 30) : '系统消息';
      anchors.push({
        messageId: msg.id,
        label,
        timestamp: msg.timestamp,
        role: 'system',
        kind: 'system',
      });
    }
  });
  
  return anchors;
}

function getAnchorIcon(kind: MessageAnchor['kind']) {
  switch (kind) {
    case 'user_message': return <User size={12} />;
    case 'assistant_text': return <MessageSquare size={12} />;
    case 'tool_call': return <Code size={12} />;
    case 'thinking': return <Lightbulb size={12} />;
    case 'system': return <Info size={12} />;
    default: return <Bot size={12} />;
  }
}

export default function MessageAnchorRail({ messages, onAnchorClick }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const anchors = useMemo(() => getAnchors(messages), [messages]);

  if (anchors.length === 0) return null;

  return (
    <div className="anchor-rail">
      <div className="anchor-rail-track">
        {anchors.map((anchor, idx) => (
          <div
            key={`${anchor.messageId}-${idx}`}
            className={`anchor-dot anchor-${anchor.kind} ${hoveredIdx === idx ? 'hovered' : ''}`}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={() => onAnchorClick(anchor.messageId)}
            title={anchor.label}
          >
            {getAnchorIcon(anchor.kind)}
            {hoveredIdx === idx && (
              <div className="anchor-tooltip">
                <span className="anchor-tooltip-label">{anchor.label}</span>
                <span className="anchor-tooltip-time">
                  {new Date(anchor.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
