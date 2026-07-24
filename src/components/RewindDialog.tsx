import { AlertTriangle, Clock, MessageSquare } from 'lucide-react';
import type { ChatMessage } from '../types';

interface Props {
  targetMessage: ChatMessage;
  messageIndex: number;
  totalMessages: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RewindDialog({ targetMessage, messageIndex, totalMessages, onConfirm, onCancel }: Props) {
  const preview = targetMessage.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join(' ')
    .slice(0, 120);

  const time = new Date(targetMessage.timestamp).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const remaining = totalMessages - messageIndex - 1;

  return (
    <div className="permission-overlay" onClick={onCancel}>
      <div className="rewind-dialog" onClick={e => e.stopPropagation()}>
        <div className="rewind-header">
          <AlertTriangle size={20} className="rewind-icon" />
          <h3>回溯会话</h3>
        </div>
        <div className="rewind-body">
          <p className="rewind-warning">
            回滚到此消息将删除之后的所有对话记录。此操作不可撤销。
          </p>
          <div className="rewind-target">
            <div className="rewind-target-header">
              <MessageSquare size={14} />
              <span className="rewind-role">{targetMessage.role === 'user' ? '用户' : '助手'}</span>
              <span className="rewind-time"><Clock size={12} /> {time}</span>
            </div>
            <p className="rewind-preview">{preview || '(无文本内容)'}</p>
          </div>
          {remaining > 0 && (
            <p className="rewind-impact">
              将删除 <strong>{remaining}</strong> 条后续消息
            </p>
          )}
        </div>
        <div className="rewind-actions">
          <button className="perm-btn" onClick={onCancel}>取消</button>
          <button className="perm-btn deny-btn" onClick={onConfirm}>
            <AlertTriangle size={14} /> 确认回溯
          </button>
        </div>
      </div>
    </div>
  );
}
