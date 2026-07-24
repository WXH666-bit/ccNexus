import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import MessageItem from './MessageItem';

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
  };

  return (
    <div className="message-list" ref={containerRef} onScroll={handleScroll}>
      {messages.map((msg, idx) => (
        <MessageItem 
          key={msg.id} 
          message={msg} 
          messageIndex={idx}
          searchHighlight={searchHighlight}
          onRewind={onRewind}
        />
      ))}
      {isStreaming && messages.length > 0 && messages[messages.length - 1].isStreaming && messages[messages.length - 1].content.length === 0 && (
        <div className="waiting-indicator">
          <span className="dot" /><span className="dot" /><span className="dot" />
        </div>
      )}
      <div ref={bottomRef} />
      {!autoScroll && (
        <button className="scroll-to-bottom" onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>
          ↓
        </button>
      )}
    </div>
  );
}
