import { useState, useEffect, useCallback } from 'react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ScrollControlProps {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  hasNewMessage: boolean;
  onScrollToBottom: () => void;
}

export function ScrollControl({ scrollContainerRef, hasNewMessage, onScrollToBottom }: ScrollControlProps) {
  const { t } = useTranslation();
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkIfAtBottom = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAtBottom(isAtBottom);
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', checkIfAtBottom);
    return () => container.removeEventListener('scroll', checkIfAtBottom);
  }, [scrollContainerRef, checkIfAtBottom]);

  // Auto-scroll when at bottom and new message arrives
  useEffect(() => {
    if (isAtBottom && hasNewMessage) {
      onScrollToBottom();
    }
  }, [hasNewMessage, isAtBottom, onScrollToBottom]);

  if (isAtBottom) return null;

  return (
    <button
      className="scroll-control-btn"
      onClick={onScrollToBottom}
      title={hasNewMessage ? t('scroll.newMessages') : t('scroll.scrollToBottom')}
    >
      {hasNewMessage ? (
        <>
          <MessageCircle size={18} />
          <span className="scroll-badge">!</span>
        </>
      ) : (
        <ArrowDown size={18} />
      )}
    </button>
  );
}
