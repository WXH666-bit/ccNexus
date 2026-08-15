import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CheckSquare, ChevronLeft, Copy, Download, Edit3, MessageSquare, Search, Star, Trash2, X } from 'lucide-react';
import RefreshIcon from '../components/RefreshIcon';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Session } from '../types';
import { useDesktopChat } from '../hooks/useDesktopChat';
import { deleteSession, getSessions, loadSession, renameSession, toggleFavoriteSession } from '../utils/sessionBridgeApi';
import { normalizeDesktopChatEvent } from '../utils/desktopChatEvents.js';
import { exportSession } from '../utils/desktopBridgeApi';

export default function HistoryView() {
  const navigate = useNavigate();
  const { incomingMessages } = useDesktopChat();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] =
    useState<{ type: 'single'; id: string } | { type: 'batch' } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deepSearchMatches, setDeepSearchMatches] = useState<Set<string> | null>(null);
  const [deepSearching, setDeepSearching] = useState(false);
  const processedIncomingMessageCountRef = useRef(0);

  useEffect(() => {
    void getSessions()
      .then(event => setSessions(event.sessions))
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    const nextMessages = incomingMessages.slice(processedIncomingMessageCountRef.current);
    processedIncomingMessageCountRef.current = incomingMessages.length;

    for (const rawMessage of nextMessages) {
      const message = normalizeDesktopChatEvent(rawMessage) as typeof rawMessage;
      if (message.type === 'session_list') {
        setSessions(message.sessions);
      } else if (message.type === 'session_created') {
        setSessions(prev => prev.some(s => s.id === message.session.id)
          ? prev.map(s => s.id === message.session.id ? message.session : s)
          : [message.session, ...prev]);
      } else if (message.type === 'session_renamed') {
        setSessions(prev => prev.map(s => s.id === message.session_id ? { ...s, title: message.title } : s));
        setEditingId(null);
      } else if (message.type === 'session_deleted') {
        setSessions(prev => prev.filter(s => s.id !== message.sessionId));
      } else if (message.type === 'session_favorite_changed') {
        setSessions(prev => prev.map(s => s.id === message.sessionId
          ? { ...s, isFavorite: message.isFavorite, favoritedAt: message.favoritedAt }
          : s));
      }
    }
  }, [incomingMessages]);

  const filtered = sessions
    .filter(s => !showFavorites || s.isFavorite)
    .filter(s => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      if (String(s.title || '').toLowerCase().includes(query)) return true;
      return deepSearchMatches?.has(s.id) || false;
    })
    .sort((a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite))
      || (b.favoritedAt || 0) - (a.favoritedAt || 0)
      || b.updatedAt - a.updatedAt);

  const handleDelete = (id: string) => {
    setPendingDelete({ type: 'single', id });
  };

  const performDelete = async () => {
    const pending = pendingDelete;
    setPendingDelete(null);
    setDeleteError(null);
    if (!pending) return;
    if (pending.type === 'single') {
      try {
        await deleteSession(pending.id);
      } catch {
        setDeleteError('删除失败：文件被占用，请稍后重试');
        return;
      }
      setSessions(prev => prev.filter(s => s.id !== pending.id));
      const refreshed = await getSessions().catch(() => null);
      if (refreshed) setSessions(refreshed.sessions);
    } else {
      const ids = [...selectedIds];
      const results = await Promise.all(ids.map(async id => ({
        id,
        ok: await deleteSession(id).then(() => true).catch(() => false),
      })));
      const succeeded = new Set(results.filter(result => result.ok).map(result => result.id));
      const failedCount = results.length - succeeded.size;
      setSessions(previous => previous.filter(session => !succeeded.has(session.id)));
      if (failedCount > 0) {
        setDeleteError(`删除失败：${failedCount} 个会话文件被占用，请稍后重试`);
      }
      setSelectedIds(new Set());
      setSelectionMode(false);
    }
  };

  const handleDeepSearch = async () => {
    const query = search.trim().toLowerCase();
    if (!query || deepSearching) return;
    setDeepSearching(true);
    const matches = new Set<string>();
    await Promise.all(sessions.map(async session => {
      const history = await loadSession(session.id).catch(() => ({ messages: [] }));
      const haystack = (history.messages || []).flatMap(message => (message.content || []).map(block => {
        if (block.type === 'text') return block.text;
        if (block.type === 'thinking') return block.thinking || '';
        return '';
      })).join('\n').toLowerCase();
      if (haystack.includes(query)) matches.add(session.id);
    }));
    setDeepSearchMatches(matches);
    setDeepSearching(false);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(previous => previous.size === filtered.length
      ? new Set()
      : new Set(filtered.map(session => session.id)));
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    setPendingDelete({ type: 'batch' });
  };

  const handleRename = async (id: string) => {
    if (editValue.trim()) {
      await renameSession(id, editValue.trim());
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editValue.trim() } : s));
      const refreshed = await getSessions().catch(() => null);
      if (refreshed) setSessions(refreshed.sessions);
    }
    setEditingId(null);
  };

  const handleExport = async (session: Session) => {
    await exportSession(session.id, session.title).catch(() => null);
  };

  const handleToggleFavorite = async (session: Session) => {
    const result = await toggleFavoriteSession(session.id).catch(() => null);
    if (!result) return;
    setSessions(prev => prev.map(item => item.id === session.id
      ? { ...item, isFavorite: result.isFavorite, favoritedAt: result.favoritedAt }
      : item));
  };

  const handleCopyId = async (sessionId: string) => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedId(sessionId);
      window.setTimeout(() => setCopiedId(current => current === sessionId ? null : current), 1800);
    } catch {
      setCopiedId(null);
    }
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
        <div className="history-header-main">
          <button className="view-back-btn" onClick={() => navigate('/chat')} title="Back to chat" aria-label="Back to chat">
            <ChevronLeft size={18} />
          </button>
          <h2>会话历史</h2>
        </div>
        <div className="history-filters">
          <div className="search-box">
            <Search size={16} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setDeepSearchMatches(null); }}
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
          <button
            className={`filter-btn ${selectionMode ? 'active' : ''}`}
            onClick={() => { setSelectionMode(value => !value); setSelectedIds(new Set()); }}
            title="选择模式"
            aria-label="选择模式"
          >
            <CheckSquare size={16} />
          </button>
          <button
            className="filter-btn"
            onClick={() => { void handleDeepSearch(); }}
            disabled={!search.trim() || deepSearching}
            title="深度搜索"
            aria-label="深度搜索"
          >
            <RefreshIcon size={16} spinning={deepSearching} />
          </button>
          {selectionMode && (
            <>
              <button className="filter-btn" onClick={toggleSelectAll} title="全选" aria-label="全选">
                <CheckSquare size={16} />
              </button>
              <button className="filter-btn danger-btn" onClick={() => { void handleBatchDelete(); }} disabled={selectedIds.size === 0} title="删除选中" aria-label="删除选中">
                <Trash2 size={16} />
              </button>
              <button className="filter-btn" onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }} title="退出选择" aria-label="退出选择">
                <X size={16} />
              </button>
            </>
          )}
        </div>
      </div>
      {deleteError && (
        <div className="history-delete-error" role="alert">
          <span>{deleteError}</span>
          <button type="button" onClick={() => setDeleteError(null)} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="history-list">
        {filtered.length === 0 ? (
          <div className="history-empty">
            <MessageSquare size={48} className="empty-icon" />
            <p>暂无会话</p>
          </div>
        ) : (
          filtered.map(session => (
            <div key={session.id} className={`history-item ${selectedIds.has(session.id) ? 'selected' : ''}`}>
              {selectionMode && (
                <input
                  className="history-item-checkbox"
                  type="checkbox"
                  checked={selectedIds.has(session.id)}
                  onChange={() => toggleSelected(session.id)}
                  aria-label={`选择 ${session.title || session.id}`}
                />
              )}
              <div className="history-item-main" onClick={() => selectionMode ? toggleSelected(session.id) : navigate(`/chat/${session.id}`)}>
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
                <button
                  onClick={() => { void handleToggleFavorite(session); }}
                  title={session.isFavorite ? '取消收藏' : '收藏'}
                  aria-label={session.isFavorite ? '取消收藏' : '收藏'}
                  className={session.isFavorite ? 'active' : ''}
                >
                  <Star size={14} fill={session.isFavorite ? 'currentColor' : 'none'} />
                </button>
                <button onClick={() => { void handleCopyId(session.id); }} title="复制会话 ID" aria-label="复制会话 ID">
                  {copiedId === session.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
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
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.type === 'batch' ? '删除选中会话' : '删除会话'}
          message={pendingDelete.type === 'batch'
            ? `确定删除选中的 ${selectedIds.size} 个会话吗？删除后无法恢复。`
            : '确定删除这个会话吗？删除后无法恢复。'}
          confirmText="删除"
          danger
          onConfirm={() => { void performDelete(); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
