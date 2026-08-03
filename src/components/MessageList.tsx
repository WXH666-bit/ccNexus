import type { ChatMessage } from '../types';
import MessageItem from './MessageItem';
import { findToolResultForBlock } from '../utils/toolRendering.js';
import { useScrollBehavior } from '../hooks/useScrollBehavior';
import { ArrowDown } from 'lucide-react';

interface SearchHighlight {
  query: string;
  currentMatchId?: string;
  totalMatches: number;
  currentMatchIndex: number;
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  searchHighlight?: SearchHighlight;
  onRewind?: (messageId: string) => void;
}

export default function MessageList({ messages, isStreaming, searchHighlight, onRewind }: MessageListProps) {
  const { containerRef, bottomRef, autoScroll, scrollToBottom } = useScrollBehavior({
    contentVersion: messages,
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
