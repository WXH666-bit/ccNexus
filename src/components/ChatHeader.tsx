import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Plus, PlusSquare, History, Settings, ChevronLeft, Pencil, Check, X, ChevronDown, ChevronUp, RotateCcw, FolderPlus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { SearchResult } from '../types';

interface ChatHeaderProps {
  sessionTitle: string;
  onNewSession: () => void;
  onRenameSession: (title: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchResults?: SearchResult[];
  currentSearchIdx?: number;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onRewind?: () => void;
  onOpenProject?: () => void;
  onOpenHistory?: () => void;
}

export default function ChatHeader({ 
  sessionTitle, onNewSession, onRenameSession,
  searchQuery, onSearchChange, searchResults, currentSearchIdx,
  onSearchNext, onSearchPrev, onRewind, onOpenProject, onOpenHistory
}: ChatHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(sessionTitle);
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isSubView = location.pathname !== '/chat' && !location.pathname.startsWith('/chat/');

  const startEdit = () => {
    setEditValue(sessionTitle);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const saveEdit = () => {
    if (editValue.trim()) {
      onRenameSession(editValue.trim());
    }
    setEditing(false);
  };

  const toggleSearch = () => {
    setSearchOpen(!searchOpen);
    if (!searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else if (onSearchChange) {
      onSearchChange('');
    }
  };

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  return (
    <header className="chat-header">
      <div className="chat-header-left">
        {isSubView && (
          <button className="header-btn" onClick={() => navigate('/chat')} title="返回对话">
            <ChevronLeft size={18} />
          </button>
        )}
        {editing ? (
          <div className="title-edit">
            <input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
              className="title-input"
            />
            <button className="header-btn icon-sm" onClick={saveEdit} title="保存"><Check size={14} /></button>
            <button className="header-btn icon-sm" onClick={() => setEditing(false)} title="取消"><X size={14} /></button>
          </div>
        ) : (
          <span className="session-title" onClick={startEdit} title="点击编辑标题">
            {sessionTitle || '新会话'}
            <Pencil size={12} className="title-edit-icon" />
          </span>
        )}
      </div>
      
      {searchOpen && (
        <div className="search-bar">
          <Search size={14} className="search-bar-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="搜索对话内容..."
            value={searchQuery || ''}
            onChange={e => onSearchChange?.(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onSearchNext?.();
              if (e.key === 'Escape') toggleSearch();
            }}
          />
          {searchResults && searchResults.length > 0 && (
            <span className="search-count">
              {(currentSearchIdx || 0) + 1}/{searchResults.length}
            </span>
          )}
          {searchResults && searchResults.length > 0 && (
            <>
              <button className="search-nav-btn" onClick={onSearchPrev} title="上一个">
                <ChevronUp size={14} />
              </button>
              <button className="search-nav-btn" onClick={onSearchNext} title="下一个">
                <ChevronDown size={14} />
              </button>
            </>
          )}
          <button className="search-close-btn" onClick={toggleSearch} title="关闭搜索">
            <X size={14} />
          </button>
        </div>
      )}
      
      <div className="chat-header-right">
        <button 
          className={`header-btn ${searchOpen ? 'active' : ''}`} 
          title="搜索对话" 
          onClick={toggleSearch}
        >
          <Search size={18} />
        </button>
        {onRewind && (
          <button className="header-btn" title="回溯会话" onClick={onRewind}>
            <RotateCcw size={18} />
          </button>
        )}
        {onOpenProject && (
          <button className="header-btn" title="打开项目" onClick={onOpenProject}>
            <FolderPlus size={18} />
          </button>
        )}
        <button className="header-btn" title="新建会话" onClick={onNewSession}>
          <Plus size={18} />
        </button>
        <button className="header-btn" title="新建标签页" onClick={() => window.open(location.pathname, '_blank')}>
          <PlusSquare size={18} />
        </button>
        <button
          className={`header-btn ${location.pathname.startsWith('/history') ? 'active' : ''}`}
          title="历史"
          onClick={() => onOpenHistory ? onOpenHistory() : navigate('/history')}
        >
          <History size={18} />
        </button>
        <button
          className={`header-btn ${location.pathname.startsWith('/settings') ? 'active' : ''}`}
          title="设置"
          onClick={() => navigate('/settings')}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
