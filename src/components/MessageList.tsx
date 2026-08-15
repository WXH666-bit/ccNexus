import type { ChatMessage } from '../types';
import type { QueuedChatMessage } from '../utils/abortWindowState.js';
import MessageItem from './MessageItem';
import { findToolResultForBlock } from '../utils/toolRendering.js';
import { useScrollBehavior } from '../hooks/useScrollBehavior';
import { ArrowDown, Hourglass } from 'lucide-react';

interface SearchHighlight {
  query: string;
  currentMatchId?: string;
  totalMatches: number;
  currentMatchIndex: number;
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  queuedMessages?: QueuedChatMessage[];
  searchHighlight?: SearchHighlight;
  onRewind?: (messageId: string) => void;
}

export default function MessageList({ messages, isStreaming, queuedMessages = [], searchHighlight, onRewind }: MessageListProps) {
  const { containerRef, bottomRef, autoScroll, scrollToBottom } = useScrollBehavior({
    contentVersion: `${messages.length}:${queuedMessages.length}`,
    streamingActive: isStreaming,
  });

  return (
    <div className="message-list" ref={containerRef}>
      <div className="message-list-content">
        {messages.map((msg, idx) => (
          <MessageItem
            key={msg.id}
            message={msg}
            messageIndex={idx}
            isLast={idx === messages.length - 1}
            searchHighlight={searchHighlight}
            onRewind={onRewind}
            findToolResult={(toolId, messageIndex) => findToolResultForBlock(messages, messageIndex, toolId)}
          />
        ))}
        {isStreaming && messages.length > 0 && messages[messages.length - 1].isStreaming && messages[messages.length - 1].content.length === 0 && (
          <div className="waiting-indicator">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}
        {queuedMessages.map((msg, idx) => (
          <div key={msg.id} className="message-row user-row queued-message-row">
            <div className="user-message-stack">
              <div className="user-message-actions">
                <span className="queued-badge">
                  <Hourglass size={12} />
                  排队中 #{idx + 1}
                </span>
              </div>
              <div className="message-bubble user-bubble queued-bubble">
                <span className="message-text user-message-text">{msg.text}</span>
                {msg.attachments.length > 0 && (
                  <div className="queued-attachment-note">📎 附件 × {msg.attachments.length}</div>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {!autoScroll && (
        <button
          className="scroll-to-bottom"
          onClick={() => scrollToBottom('smooth')}
          title="Scroll to latest message"
          aria-label="Scroll to latest message"
        >
          <ArrowDown size={17} />
        </button>
      )}
    </div>
  );
}
