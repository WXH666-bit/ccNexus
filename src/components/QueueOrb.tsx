import { useRef, useState } from 'react';
import { Check, ListOrdered, Pencil, Trash2, X } from 'lucide-react';
import type { QueuedChatMessage } from '../utils/abortWindowState.js';

interface QueueOrbProps {
  queue: QueuedChatMessage[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onClear: () => void;
}

export default function QueueOrb({ queue, onRemove, onUpdate, onClear }: QueueOrbProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const closeTimer = useRef<number | null>(null);

  const openNow = () => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { setOpen(false); setEditingId(null); }, 200);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (editingId && trimmed) onUpdate(editingId, trimmed);
    setEditingId(null);
    setDraft('');
  };

  return (
    <div className="queue-orb-wrap"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      <button
        type="button"
        className={`queue-orb ${queue.length > 0 ? 'active' : ''}`}
        onClick={() => (open ? closeSoon() : openNow())}
        title="排队中的消息"
        aria-label="排队中的消息"
      >
        <ListOrdered size={13} />
        {queue.length > 0 && <span className="queue-orb-badge">{queue.length}</span>}
      </button>

      {open && (
        <div className="queue-orb-popover">
          <div className="queue-orb-popover-header">
            <span>排队中的消息{queue.length > 0 ? ` (${queue.length})` : ''}</span>
            {queue.length > 0 && (
              <button type="button" className="queue-orb-clear" onClick={onClear} title="清空全部">
                <Trash2 size={13} />
              </button>
            )}
          </div>
          {queue.length === 0 ? (
            <div className="queue-orb-empty">当前没有排队中的消息</div>
          ) : (
            queue.map((msg, idx) => (
              <div key={msg.id} className="queue-orb-item">
                <span className="queue-orb-index">#{idx + 1}</span>
                {editingId === msg.id ? (
                  <>
                    <input
                      className="queue-orb-edit-input"
                      value={draft}
                      autoFocus
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                        if (e.key === 'Escape') { setEditingId(null); setDraft(''); }
                      }}
                    />
                    <button type="button" className="queue-orb-item-btn confirm" onClick={commitEdit} title="保存"><Check size={13} /></button>
                    <button type="button" className="queue-orb-item-btn" onClick={() => { setEditingId(null); setDraft(''); }} title="取消编辑"><X size={13} /></button>
                  </>
                ) : (
                  <>
                    <span className="queue-orb-text" title={msg.text}>{msg.text}</span>
                    <button type="button" className="queue-orb-item-btn" onClick={() => { setEditingId(msg.id); setDraft(msg.text); }} title="编辑"><Pencil size={13} /></button>
                    <button type="button" className="queue-orb-item-btn" onClick={() => onRemove(msg.id)} title="取消排队"><X size={13} /></button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
