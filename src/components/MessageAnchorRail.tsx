import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { MessageSquare, Bot, User, Code, Lightbulb, Info } from 'lucide-react';
import type { ChatMessage, MessageAnchor } from '../types';

interface Props {
  messages: ChatMessage[];
  onAnchorClick: (messageId: string) => void;
  showToolAnchors?: boolean;
}

interface PositionedAnchor extends MessageAnchor {
  position: number;
}

interface TooltipState {
  idx: number;
  top: number;
  label: string;
  timestamp: number;
}

function getText(message: ChatMessage) {
  const text = message.content.find(block => block.type === 'text');
  return text?.type === 'text' ? text.text : '';
}

/**
 * ccgui's rail is a compact conversation navigator: user messages are the
 * default anchors, while tool/thinking nodes are opt-in detail anchors.
 * Positions are distributed against the rail track instead of stacking in a
 * scrollable overlay, so the rail remains stable while message bubbles grow.
 */
function getAnchors(messages: ChatMessage[], showToolAnchors: boolean): PositionedAnchor[] {
  const anchors: MessageAnchor[] = [];

  messages.forEach(message => {
    if (message.role === 'user') {
      anchors.push({
        messageId: message.id,
        label: getText(message).slice(0, 300) || 'User message',
        timestamp: message.timestamp,
        role: 'user',
        kind: 'user_message',
      });
      return;
    }

    if (!showToolAnchors || message.role !== 'assistant') return;
    const text = getText(message);
    if (text) {
      anchors.push({
        messageId: message.id,
        label: text.slice(0, 300),
        timestamp: message.timestamp,
        role: 'assistant',
        kind: 'assistant_text',
      });
    }
    message.content.forEach(block => {
      if (block.type === 'tool_use') {
        anchors.push({
          messageId: message.id,
          label: block.name,
          timestamp: message.timestamp,
          role: 'assistant',
          kind: 'tool_call',
        });
      } else if (block.type === 'thinking') {
        anchors.push({
          messageId: message.id,
          label: 'Thinking process',
          timestamp: message.timestamp,
          role: 'assistant',
          kind: 'thinking',
        });
      }
    });
  });

  // ccgui hides the rail until there are at least two conversation anchors.
  // A lone dot adds noise and can sit on top of the only user bubble.
  if (anchors.length <= 1) return [];
  return anchors.map((anchor, index) => ({
    ...anchor,
    position: anchors.length === 1
      ? 0.5
      : 0.04 + (index / (anchors.length - 1)) * 0.92,
  }));
}

function getAnchorIcon(kind: MessageAnchor['kind']) {
  switch (kind) {
    case 'user_message': return <User size={10} />;
    case 'assistant_text': return <MessageSquare size={10} />;
    case 'tool_call': return <Code size={10} />;
    case 'thinking': return <Lightbulb size={10} />;
    case 'system': return <Info size={10} />;
    default: return <Bot size={10} />;
  }
}

function scrollToMessage(messageId: string) {
  const node = document.getElementById(`msg-${messageId}`);
  node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function MessageAnchorRail({ messages, onAnchorClick, showToolAnchors = false }: Props) {
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);
  const anchors = useMemo(() => getAnchors(messages, showToolAnchors), [messages, showToolAnchors]);

  if (anchors.length === 0) return null;

  const showTooltip = (anchor: PositionedAnchor, idx: number, event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    setTooltipState({
      idx,
      top: Math.min(Math.max(centerY, 28), window.innerHeight - 28),
      label: anchor.label,
      timestamp: anchor.timestamp,
    });
  };

  const activateAnchor = (anchor: PositionedAnchor) => {
    onAnchorClick(anchor.messageId);
    scrollToMessage(anchor.messageId);
  };

  const handleKeyDown = (anchor: PositionedAnchor, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateAnchor(anchor);
  };

  return (
    <div className="anchor-rail" role="navigation" aria-label="Message anchors">
      <div className="anchor-rail-track" aria-hidden="true" />
      {anchors.map((anchor, idx) => (
        <div
          key={`${anchor.messageId}-${anchor.kind}-${idx}`}
          className={`anchor-dot anchor-${anchor.kind} ${tooltipState?.idx === idx ? 'hovered' : ''}`}
          style={{ top: `${anchor.position * 100}%` }}
          role="button"
          tabIndex={0}
          onMouseEnter={(event) => showTooltip(anchor, idx, event)}
          onMouseLeave={() => setTooltipState(null)}
          onFocus={(event) => showTooltip(anchor, idx, event as unknown as MouseEvent<HTMLDivElement>)}
          onBlur={() => setTooltipState(null)}
          onKeyDown={(event) => handleKeyDown(anchor, event)}
          onClick={() => activateAnchor(anchor)}
          aria-label={anchor.label}
        >
          {getAnchorIcon(anchor.kind)}
        </div>
      ))}
      {tooltipState && (
        <div className="anchor-tooltip" style={{ top: tooltipState.top }}>
          <span className="anchor-tooltip-label">{tooltipState.label}</span>
          <span className="anchor-tooltip-time">
            {new Date(tooltipState.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  );
}
