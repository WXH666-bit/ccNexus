import { useTranslation } from 'react-i18next';
import { ListOrdered, X } from 'lucide-react';
import type { QueuedChatMessage } from '../utils/abortWindowState.js';

type QueuedMessage = QueuedChatMessage;

interface MessageQueueProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

export default function MessageQueue({ queue, onRemove, onClear }: MessageQueueProps) {
  const { t } = useTranslation();

  if (queue.length === 0) return null;

  return (
    <div className="message-queue">
      <div className="queue-header">
        <ListOrdered size={16} />
        <span>{t('chat.input.queue')} ({queue.length})</span>
        <button className="icon-btn" onClick={onClear} title="Clear all">
          <X size={14} />
        </button>
      </div>
      <div className="queue-list">
        {queue.map((msg, idx) => (
          <div key={msg.id} className="queue-item">
            <span className="queue-index">{idx + 1}</span>
            <span className="queue-text">{msg.text}</span>
            <button className="icon-btn" onClick={() => onRemove(msg.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { QueuedMessage };
