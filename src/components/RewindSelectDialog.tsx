import React, { useState } from 'react';
import { X, RotateCcw, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatMessage } from '../types';

interface RewindSelectDialogProps {
  messages: ChatMessage[];
  onRewind: (messageId: string) => void;
  onClose: () => void;
}

const RewindSelectDialog: React.FC<RewindSelectDialogProps> = ({ messages, onRewind, onClose }) => {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 过滤出用户消息作为检查点
  const checkpoints = messages
    .filter((msg) => msg.role === 'user')
    .map((msg, index) => ({
      id: msg.id,
      timestamp: msg.timestamp,
      content: msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : ''),
      turnNumber: index + 1,
    }));

  const handleRewind = () => {
    if (selectedId) {
      onRewind(selectedId);
      onClose();
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="rewind-dialog-overlay" onClick={onClose}>
      <div className="rewind-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{t('rewind.title')}</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="dialog-content">
          <p className="dialog-description">{t('rewind.description')}</p>

          {checkpoints.length === 0 ? (
            <div className="empty-state">
              <MessageSquare size={48} />
              <p>{t('rewind.noCheckpoints')}</p>
            </div>
          ) : (
            <div className="checkpoints-list">
              {checkpoints.map((checkpoint) => (
                <div
                  key={checkpoint.id}
                  className={`checkpoint-item ${selectedId === checkpoint.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(checkpoint.id)}
                >
                  <div className="checkpoint-radio">
                    <div className={`radio-dot ${selectedId === checkpoint.id ? 'checked' : ''}`} />
                  </div>
                  <div className="checkpoint-content">
                    <div className="checkpoint-header">
                      <span className="checkpoint-turn">
                        {t('rewind.turn')} {checkpoint.turnNumber}
                      </span>
                      <span className="checkpoint-time">{formatTime(checkpoint.timestamp)}</span>
                    </div>
                    <div className="checkpoint-message">{checkpoint.content}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handleRewind}
            disabled={!selectedId}
          >
            <RotateCcw size={16} />
            {t('rewind.rewind')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RewindSelectDialog;
