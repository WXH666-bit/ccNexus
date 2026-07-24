import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Star, Trash2, Edit3, Download, MessageSquare } from 'lucide-react';
import type { Session } from '../types';
import { useWebSocket } from '../hooks/useWebSocket';

export default function HistoryView() {
  const navigate = useNavigate();
  const { send, lastMessage } = useWebSocket();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    send({ type: 'get_sessions' });
  }, [send]);

  useEffect(() => {
    if (lastMessage?.type === 'session_list') {
      setSessions(lastMessage.sessions);
    }
    if (lastMessage?.type === 'session_renamed') {
      setSessions(prev => prev.map(s => s.id === lastMessage.session_id ? { ...s, title: lastMessage.title } : s));
      setEditingId(null);
    }
    if (lastMessage?.type === 'session_deleted') {
      setSessions(prev => prev.filter(s => s.id !== lastMessage.session_id));
    }
  }, [lastMessage]);

  const filtered = sessions
    .filter(s => !showFavorites || s.isFavorite)
    .filter(s => s.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const handleDelete = (id: string) => {
    send({ type: 'delete_session', session_id: id });
  };

  const handleRename = (id: string) => {
    if (editValue.trim()) {
      send({ type: 'rename_session', session_id: id, title: editValue.trim() });
    }
    setEditingId(null);
  };

  const handleExport = (session: Session) => {
    const data = JSON.stringify(session, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title || session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
  };

  return (
    <div className="history-view">
      <div className="history-header">
        <h2>会话历史</h2>
        <div className="history-filters">
          <div className="search-box">
            <Search size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索会话..."
            />
          </div>
          <button
            className={`filter-btn ${showFavorites ? 'active' : ''}`}
            onClick={() => setShowFavorites(!showFavorites)}
            title="收藏"
          >
            <Star size={16} />
          </button>
        </div>
      </div>
      <div className="history-list">
        {filtered.length === 0 ? (
          <div className="history-empty">
            <MessageSquare size={48} className="empty-icon" />
            <p>暂无会话</p>
          </div>
        ) : (
          filtered.map(session => (
            <div key={session.id} className="history-item">
              <div className="history-item-main" onClick={() => navigate(`/chat/${session.id}`)}>
                <div className="history-item-title">
                  {editingId === session.id ? (
                    <input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(session.id); if (e.key === 'Escape') setEditingId(null); }}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      {session.isFavorite && <Star size={14} className="favorite-star" />}
                      <span>{session.title || '未命名会话'}</span>
                    </>
                  )}
                </div>
                <div className="history-item-meta">
                  <span>{formatDate(session.updatedAt)}</span>
                  {session.messageCount && <span>{session.messageCount} 条消息</span>}
                </div>
              </div>
              <div className="history-item-actions">
                <button onClick={() => { setEditingId(session.id); setEditValue(session.title); }} title="重命名">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => handleExport(session)} title="导出">
                  <Download size={14} />
                </button>
                <button onClick={() => handleDelete(session.id)} title="删除" className="danger-btn">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
