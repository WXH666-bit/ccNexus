import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import ChatHeader from '../components/ChatHeader';
import MessageList from '../components/MessageList';
import ChatInputBox from '../components/ChatInputBox';
import StatusPanel from '../components/StatusPanel';
import PermissionDialog from '../components/PermissionDialog';
import WelcomeScreen from '../components/WelcomeScreen';
import RewindDialog from '../components/RewindDialog';
import PlanApprovalDialog from '../components/PlanApprovalDialog';
import MessageAnchorRail from '../components/MessageAnchorRail';
import MessageQueue from '../components/MessageQueue';
import type { QueuedMessage } from '../components/MessageQueue';
import FileExplorer from '../components/FileExplorer';
import GeneratingResponseIndicator from '../components/GeneratingResponseIndicator';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  createStreamingBlockState,
  applyStreamEventToBlocks,
  appendToolResultBlock,
  resetStreamingBlockState,
} from '../utils/streamingBlocks.js';
import {
  STREAM_STALL_CHECK_INTERVAL_MS,
  shouldRecoverStalledStream,
} from '../utils/streamWatchdog.js';
import { findToolResultForBlock, isFileModifyToolName } from '../utils/toolRendering.js';
import { normalizeToolInput } from '../utils/toolInputNormalization.js';
import { estimateMessagesUsedTokens } from '../utils/contextUsage.js';
import type { 
  ChatMessage, Session, StatusData, PermissionRequest,
  PlanApprovalRequest, AskUserQuestionRequest, SearchResult, SubAgentInfo
} from '../types';

let msgIdCounter = 0;
function genId() { return `msg-${Date.now()}-${++msgIdCounter}`; }

function readStoredPreference(key: string, fallback: string) {
  const saved = localStorage.getItem(key);
  return saved && saved.trim() ? saved : fallback;
}

export default function ChatView() {
  const { sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();
  const { send, incomingMessages, connected } = useWebSocket();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [status, setStatus] = useState<StatusData>({});
  const [mode, setModeState] = useState(() => readStoredPreference('chatMode', 'default'));
  const [model, setModelState] = useState(() => readStoredPreference('chatModel', 'default'));
  const [reasoning, setReasoningState] = useState(() => readStoredPreference('chatReasoning', 'high'));
  const [usageUsedTokens, setUsageUsedTokens] = useState<number | undefined>(undefined);

  // P1 features state
  const [rewindTarget, setRewindTarget] = useState<ChatMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentSearchIdx, setCurrentSearchIdx] = useState(0);
  const [planApproval, setPlanApproval] = useState<PlanApprovalRequest | null>(null);
  const [askQuestion, setAskQuestion] = useState<AskUserQuestionRequest | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([]);

  // P2: Message queue state
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const queueProcessingRef = useRef(false);

  // Status panel visibility
  const [showStatusPanel, setShowStatusPanel] = useState(() => {
    const saved = localStorage.getItem('showStatusPanel');
    return saved !== null ? saved === 'true' : true;
  });
  const [showToolAnchors, setShowToolAnchors] = useState(() => {
    const saved = localStorage.getItem('showToolAnchors');
    return saved === 'true';
  });

  const streamingMsgRef = useRef<string | null>(null);
  const streamingBlocksRef = useRef(createStreamingBlockState());
  const streamActivityAtRef = useRef(Date.now());
  const streamStallIntervalRef = useRef<number | null>(null);
  const requestedHistorySessionRef = useRef<string | null>(null);
  const processedIncomingMessageCountRef = useRef(0);
  // The server assigns the first session after the optimistic turn exists. Keep
  // that matching route update from being handled as a user session switch.
  const serverSessionNavigationRef = useRef<string | null>(null);

  const setMode = useCallback((nextMode: string) => {
    setModeState(nextMode);
    localStorage.setItem('chatMode', nextMode);
  }, []);

  const setModel = useCallback((nextModel: string) => {
    setModelState(nextModel);
    localStorage.setItem('chatModel', nextModel);
  }, []);

  const setReasoning = useCallback((nextReasoning: string) => {
    setReasoningState(nextReasoning);
    localStorage.setItem('chatReasoning', nextReasoning);
  }, []);

  // Search logic
  const performSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setCurrentSearchIdx(0);
      return;
    }
    
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    
    messages.forEach((msg, msgIdx) => {
      msg.content.forEach((block, blockIdx) => {
        if (block.type === 'text') {
          const text = (block as { type: 'text'; text: string }).text;
          const lowerText = text.toLowerCase();
          const idx = lowerText.indexOf(lowerQuery);
          if (idx >= 0) {
            const contextBefore = text.slice(Math.max(0, idx - 30), idx);
            const contextAfter = text.slice(idx + query.length, idx + query.length + 30);
            results.push({
              messageId: msg.id,
              messageIndex: msgIdx,
              blockIndex: blockIdx,
              matchText: text.slice(idx, idx + query.length),
              contextBefore,
              contextAfter,
            });
          }
        }
      });
    });
    
    setSearchResults(results);
    setCurrentSearchIdx(0);
  }, [messages]);

  useEffect(() => {
    const timer = setTimeout(() => performSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  // Navigate search results
  const navigateSearch = useCallback((direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return;
    const newIdx = direction === 'next' 
      ? (currentSearchIdx + 1) % searchResults.length
      : (currentSearchIdx - 1 + searchResults.length) % searchResults.length;
    setCurrentSearchIdx(newIdx);
    
    // Scroll to message
    const result = searchResults[newIdx];
    const msgEl = document.getElementById(`msg-${result.messageId}`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchResults, currentSearchIdx]);

  // Rewind handler
  const handleRewind = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (msg) {
      setRewindTarget(msg);
    }
  }, [messages]);

  const confirmRewind = useCallback(() => {
    if (!rewindTarget || !currentSession) return;
    
    send({
      type: 'rewind',
      messageId: rewindTarget.id,
      sessionId: currentSession.id,
    });
    
    // Truncate messages locally
    const idx = messages.findIndex(m => m.id === rewindTarget.id);
    if (idx >= 0) {
      setMessages(messages.slice(0, idx + 1));
    }
    
    setRewindTarget(null);
  }, [rewindTarget, currentSession, messages, send]);

  // File undo handler
  const handleUndoFile = useCallback((filePath: string) => {
    if (!currentSession) return;
    send({
      type: 'undo_file',
      filePath,
      sessionId: currentSession.id,
    });
  }, [currentSession, send]);

  // Plan approval handlers
  const handlePlanApprove = useCallback(() => {
    if (!planApproval) return;
    send({
      type: 'plan_approval_response',
      planId: planApproval.plan_id,
      approved: true,
    });
    setPlanApproval(null);
  }, [planApproval, send]);

  const handlePlanReject = useCallback((feedback: string) => {
    if (!planApproval) return;
    send({
      type: 'plan_approval_response',
      planId: planApproval.plan_id,
      approved: false,
      feedback,
    });
    setPlanApproval(null);
  }, [planApproval, send]);

  // Ask user question handler
  const handleQuestionAnswer = useCallback((answer: string, selectedOption?: string) => {
    if (!askQuestion) return;
    send({
      type: 'ask_user_question_response',
      questionId: askQuestion.question_id,
      answer,
      selectedOption,
    });
    setAskQuestion(null);
  }, [askQuestion, send]);

  // Anchor click handler
  const handleAnchorClick = useCallback((messageId: string) => {
    const msgEl = document.getElementById(`msg-${messageId}`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const finishStreamingMessage = useCallback(() => {
    setIsStreaming(false);
    streamingMsgRef.current = null;
    resetStreamingBlockState(streamingBlocksRef.current);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      if (streamStallIntervalRef.current !== null) {
        window.clearInterval(streamStallIntervalRef.current);
        streamStallIntervalRef.current = null;
      }
      return;
    }

    streamStallIntervalRef.current = window.setInterval(() => {
      if (shouldRecoverStalledStream({
        isStreaming: true,
        lastActivityAt: streamActivityAtRef.current,
        now: Date.now(),
      })) {
        finishStreamingMessage();
      }
    }, STREAM_STALL_CHECK_INTERVAL_MS);

    return () => {
      if (streamStallIntervalRef.current !== null) {
        window.clearInterval(streamStallIntervalRef.current);
        streamStallIntervalRef.current = null;
      }
    };
  }, [finishStreamingMessage, isStreaming]);

  // Initialize: request session list
  useEffect(() => {
    send({ type: 'get_sessions' });
  }, [send]);

  // Handle URL session change
  useEffect(() => {
    if (urlSessionId) {
      if (serverSessionNavigationRef.current === urlSessionId) {
        serverSessionNavigationRef.current = null;
        setCurrentSession(prev => prev?.id === urlSessionId ? prev : {
          id: urlSessionId,
          title: 'New Chat',
          updatedAt: Date.now(),
        });
        return;
      }
      // A different route is a real navigation, not the server-assigned route
      // we were waiting to consume. Disarm the old one before this switch so it
      // cannot suppress a later genuine navigation back to that stale ID.
      serverSessionNavigationRef.current = null;
      if (requestedHistorySessionRef.current !== urlSessionId) {
        requestedHistorySessionRef.current = urlSessionId;
        send({ type: 'load_session', sessionId: urlSessionId });
      }
      setMessages([]);
      setUsageUsedTokens(undefined);
      resetStreamingBlockState(streamingBlocksRef.current);
      streamingMsgRef.current = null;
    }
  }, [urlSessionId, send]);

  // Handle WebSocket messages
  useEffect(() => {
    const nextMessages = incomingMessages.slice(processedIncomingMessageCountRef.current);
    processedIncomingMessageCountRef.current = incomingMessages.length;

    for (const msg of nextMessages) {
      switch (msg.type) {
      case 'session': {
        const session: Session = {
          id: msg.sessionId,
          title: currentSession?.id === msg.sessionId ? currentSession.title : 'New Chat',
          updatedAt: Date.now(),
        };
        setSessions(prev => {
          const existing = prev.find(item => item.id === msg.sessionId);
          return existing
            ? prev.map(item => item.id === msg.sessionId ? { ...item, updatedAt: session.updatedAt } : item)
            : [...prev, session];
        });
        if (!currentSession) {
          setCurrentSession(session);
          // Do not leave a guard behind when the canonical session event already
          // matches the route (for example, after a direct URL load). A stale
          // guard could otherwise suppress a later real session switch.
          if (urlSessionId !== msg.sessionId) {
            serverSessionNavigationRef.current = msg.sessionId;
            navigate(`/chat/${msg.sessionId}`, { replace: true });
          }
        }
        break;
      }
      case 'session_list': {
        setSessions(msg.sessions);
        if (urlSessionId && msg.deletedSessionIds?.includes(urlSessionId)) {
          setCurrentSession(null);
          setMessages([]);
          navigate('/chat', { replace: true });
          break;
        }
        if (urlSessionId) {
          const s = msg.sessions.find(x => x.id === urlSessionId);
          if (s) setCurrentSession(s);
        } else if (msg.sessions.length > 0) {
          const latest = [...msg.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          setCurrentSession(latest);
          if (requestedHistorySessionRef.current !== latest.id) {
            requestedHistorySessionRef.current = latest.id;
            send({ type: 'load_session', sessionId: latest.id });
          }
        }
        break;
      }
      case 'session_created': {
        setSessions(prev => [...prev, msg.session]);
        setCurrentSession(msg.session);
        navigate(`/chat/${msg.session.id}`, { replace: true });
        break;
      }
      case 'session_deleted': {
        setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
        if (currentSession?.id === msg.sessionId) {
          setCurrentSession(null);
          setMessages([]);
          navigate('/chat', { replace: true });
        }
        break;
      }
      case 'session_renamed': {
        setSessions(prev => prev.map(s => s.id === msg.session_id ? { ...s, title: msg.title } : s));
        if (currentSession?.id === msg.session_id) {
          setCurrentSession(prev => prev ? { ...prev, title: msg.title } : prev);
        }
        break;
      }

      case 'stream_event': {
        const event = msg.event as Record<string, unknown>;
        const eventType = event.type as string;

        if (eventType === 'message_start' || eventType === 'content_block_start' || eventType === 'content_block_delta') {
          streamActivityAtRef.current = Date.now();
          applyStreamEventToBlocks(streamingBlocksRef.current, event);
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.isStreaming) {
              updated[updated.length - 1] = { ...lastMsg, content: [...streamingBlocksRef.current.blocks] };
            }
            return updated;
          });
        }
        break;
      }

      case 'assistant': {
        const completeMsg: ChatMessage = {
          id: msg.message.id || genId(),
          role: 'assistant',
          content: msg.message.content,
          timestamp: Date.now(),
          sessionId: msg.message.sessionId,
          model: msg.message.model,
          isStreaming: false,
          cost: msg.message.cost,
          duration: msg.message.duration,
          turns: msg.message.turns,
        };
        setIsStreaming(false);
        streamingMsgRef.current = null;
        resetStreamingBlockState(streamingBlocksRef.current);
        setMessages(prev => {
          const filtered = prev.filter(m => !m.isStreaming);
          return [...filtered, completeMsg];
        });
        break;
      }

      case 'tool_result': {
        streamActivityAtRef.current = Date.now();
        const resultBlock = { type: 'tool_result' as const, tool_use_id: msg.tool_use_id, content: msg.content, is_error: msg.is_error };
        appendToolResultBlock(streamingBlocksRef.current, resultBlock);
        setMessages(prev => prev.map(m => {
          if (!m.isStreaming) return m;
          return {
            ...m,
            content: [...streamingBlocksRef.current.blocks],
          };
        }));
        break;
      }

      case 'tool_progress': {
        setStatus(prev => ({
          ...prev,
          tasks: prev.tasks ? { ...prev.tasks } : undefined,
        }));
        break;
      }

      case 'permission_request': {
        setPermission({ permission_id: msg.requestId, tool_name: msg.toolName, input: msg.input });
        break;
      }
      case 'session_history': {
        if (urlSessionId && urlSessionId !== msg.sessionId) break;
        requestedHistorySessionRef.current = msg.sessionId;
        resetStreamingBlockState(streamingBlocksRef.current);
        streamingMsgRef.current = null;
        setIsStreaming(false);
        setMessages(msg.messages);
        setUsageUsedTokens(estimateMessagesUsedTokens(msg.messages));
        setCurrentSession(prev => prev?.id === msg.sessionId
          ? prev
          : sessions.find(session => session.id === msg.sessionId) || {
            id: msg.sessionId,
            title: 'New Chat',
            updatedAt: Date.now(),
          });
        break;
      }

      case 'status': {
        if (msg.status === 'idle') {
          finishStreamingMessage();
        }
        break;
      }

      case 'usage_update': {
        setUsageUsedTokens(msg.usedTokens);
        break;
      }

      case 'result': {
        finishStreamingMessage();
        break;
      }

      case 'error': {
        finishStreamingMessage();
        if (msg.invalidSessionId) {
          setSessions(prev => prev.filter(session => session.id !== msg.invalidSessionId));
          if (currentSession?.id === msg.invalidSessionId) {
            setCurrentSession(null);
            setMessages([]);
            navigate('/chat', { replace: true });
          }
          break;
        }
        setMessages(prev => [
          ...prev,
          { id: genId(), role: 'system', content: [{ type: 'text', text: `Error: ${msg.message}` }], timestamp: Date.now() },
        ]);
        break;
      }

      // P1 features
      case 'plan_approval': {
        setPlanApproval(msg.plan);
        break;
      }

      case 'ask_user_question': {
        setAskQuestion(msg.question);
        break;
      }

      case 'subagent_update': {
        setSubAgents(msg.agents);
        setStatus(prev => ({ ...prev, subagents: msg.agents }));
        break;
      }

      case 'rewind_complete': {
        setMessages(msg.messages);
        setUsageUsedTokens(estimateMessagesUsedTokens(msg.messages));
        break;
      }

      case 'undo_complete': {
        if (msg.success) {
          // Refresh status
          setStatus(prev => {
            if (!prev.edits) return prev;
            const newFiles = prev.edits.files.filter(f => f !== msg.filePath);
            return { ...prev, edits: { ...prev.edits, files: newFiles } };
          });
        }
          break;
        }
      }
    }
  }, [incomingMessages, urlSessionId, navigate, currentSession, finishStreamingMessage]);

  const handleSend = useCallback((text: string, attachments: { type: string; data: string }[] = [], queue: boolean = false, reasoningEffort?: string, agent?: string, streaming?: boolean, alwaysThinking?: boolean, modelOverride?: string) => {
    if (!text.trim() && attachments.length === 0) return;

    // If AI is streaming and queue is requested, add to queue
    if (isStreaming && queue) {
      const queuedMsg: QueuedMessage = {
        id: genId(),
        text: text.trim(),
        timestamp: Date.now(),
      };
      setMessageQueue(prev => [...prev, queuedMsg]);
      return;
    }

    // If AI is streaming but not queued, still add to queue
    if (isStreaming) {
      const queuedMsg: QueuedMessage = {
        id: genId(),
        text: text.trim(),
        timestamp: Date.now(),
      };
      setMessageQueue(prev => [...prev, queuedMsg]);
      return;
    }

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: [{ type: 'text', text: text.trim() }],
      timestamp: Date.now(),
      sessionId: currentSession?.id,
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    streamActivityAtRef.current = Date.now();

    const streamingId = genId();
    streamingMsgRef.current = streamingId;
    resetStreamingBlockState(streamingBlocksRef.current);
    setMessages(prev => [...prev, {
      id: streamingId,
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      isStreaming: true,
    }]);

    send({
      type: 'chat',
      text: text.trim(),
      sessionId: currentSession?.id,
      images: attachments,
      options: { 
        mode, 
        model: modelOverride || model, 
        reasoning: reasoningEffort || reasoning,
        agent,
        streaming,
        alwaysThinking,
      },
    });
  }, [send, currentSession, mode, model, reasoning, isStreaming]);

  // Process message queue when streaming completes
  useEffect(() => {
    if (!isStreaming && messageQueue.length > 0 && !queueProcessingRef.current) {
      queueProcessingRef.current = true;
      const nextMsg = messageQueue[0];
      setMessageQueue(prev => prev.slice(1));
      
      // Send the queued message
      setTimeout(() => {
        handleSend(nextMsg.text, [], false);
        queueProcessingRef.current = false;
      }, 100);
    }
  }, [isStreaming, messageQueue, handleSend]);

  // Queue management
  const removeFromQueue = useCallback((id: string) => {
    setMessageQueue(prev => prev.filter(m => m.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);

  const handleStop = useCallback(() => {
    send({ type: 'abort', sessionId: currentSession?.id });
    finishStreamingMessage();
  }, [send, currentSession, finishStreamingMessage]);

  const handleNewSession = useCallback(() => {
    send({ type: 'new_session' });
    setMessages([]);
    resetStreamingBlockState(streamingBlocksRef.current);
    streamingMsgRef.current = null;
    setIsStreaming(false);
  }, [send]);

  const handleRenameSession = useCallback((title: string) => {
    if (currentSession) {
      send({ type: 'rename_session', session_id: currentSession.id, title });
    }
  }, [send, currentSession]);

  const handlePermission = useCallback((permissionId: string, behavior: 'allow' | 'deny' | 'always_allow') => {
    send({ type: 'permission_response', requestId: permissionId, behavior, allow: behavior !== 'deny' });
    setPermission(null);
  }, [send]);

  // Compute status data from messages
  useEffect(() => {
    let additions = 0;
    let deletions = 0;
    const files = new Set<string>();

    messages.forEach((m, messageIndex) => {
      m.content.forEach(block => {
        if (block.type === 'tool_use' && isFileModifyToolName(block.name)) {
          const result = findToolResultForBlock(messages, messageIndex, block.id);
          if (!result || result.is_error) return;

          const input = normalizeToolInput(block.name, block.input) ?? block.input;
          const filePath = input.file_path as string || input.path as string || '';
          if (filePath) files.add(filePath);
          const oldStr = input.old_string as string || '';
          const newStr = input.new_string as string || '';
          if (oldStr) deletions += oldStr.split('\n').length;
          if (newStr) additions += newStr.split('\n').length;
        }
      });
    });

    if (additions > 0 || deletions > 0 || files.size > 0) {
      setStatus(prev => ({ ...prev, edits: { additions, deletions, files: Array.from(files) } }));
    }
  }, [messages]);

  // Search highlight prop
  const searchHighlight = useMemo(() => {
    if (!searchQuery || searchResults.length === 0) return undefined;
    return {
      query: searchQuery,
      currentMatchId: searchResults[currentSearchIdx]?.messageId,
      totalMatches: searchResults.length,
      currentMatchIndex: currentSearchIdx,
    };
  }, [searchQuery, searchResults, currentSearchIdx]);

  return (
    <div className="chat-view">
      <FileExplorer />
      <div className="chat-pane">
        <ChatHeader
          sessionTitle={currentSession?.title || ''}
          onNewSession={handleNewSession}
          onRenameSession={handleRenameSession}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchResults={searchResults}
          currentSearchIdx={currentSearchIdx}
          onSearchNext={() => navigateSearch('next')}
          onSearchPrev={() => navigateSearch('prev')}
          onRewind={rewindTarget ? () => setRewindTarget(null) : undefined}
        />
        <div className="chat-main">
          {messages.length === 0 ? (
            <WelcomeScreen onSuggestion={handleSend} />
          ) : (
            <div className="chat-content-with-rail">
              <MessageList 
                messages={messages} 
                isStreaming={isStreaming}
                searchHighlight={searchHighlight}
              />
              <MessageAnchorRail 
                messages={messages}
                onAnchorClick={handleAnchorClick}
                showToolAnchors={showToolAnchors}
              />
            </div>
          )}
        </div>
        <GeneratingResponseIndicator isStreaming={isStreaming} />
        {showStatusPanel && <StatusPanel status={status} onUndoFile={handleUndoFile} />}
        <MessageQueue 
          queue={messageQueue} 
          onRemove={removeFromQueue} 
          onClear={clearQueue} 
        />
        <ChatInputBox
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          connected={connected}
          mode={mode}
          setMode={setMode}
          model={model}
          setModel={setModel}
          reasoning={reasoning}
          setReasoning={setReasoning}
          showStatusPanel={showStatusPanel}
          setShowStatusPanel={setShowStatusPanel}
          showToolAnchors={showToolAnchors}
          setShowToolAnchors={setShowToolAnchors}
          usageUsedTokens={usageUsedTokens}
        />
      </div>
      {permission && (
        <PermissionDialog
          permission={permission}
          onAllow={() => handlePermission(permission.permission_id, 'allow')}
          onDeny={() => handlePermission(permission.permission_id, 'deny')}
          onAlwaysAllow={() => handlePermission(permission.permission_id, 'always_allow')}
        />
      )}
      {rewindTarget && (
        <RewindDialog
          targetMessage={rewindTarget}
          messageIndex={messages.findIndex(m => m.id === rewindTarget.id)}
          totalMessages={messages.length}
          onConfirm={confirmRewind}
          onCancel={() => setRewindTarget(null)}
        />
      )}
      {planApproval && (
        <PlanApprovalDialog
          plan={planApproval}
          onApprove={handlePlanApprove}
          onReject={handlePlanReject}
        />
      )}
      {askQuestion && (
        <div className="ask-question-overlay">
          <div className="ask-question-container">
            <div className="ask-question-header">
              <span className="ask-icon">?</span>
              <span>需要您的回答</span>
            </div>
            <div className="ask-question-body">
              <p>{askQuestion.question}</p>
              {askQuestion.options && (
                <div className="ask-options">
                  {askQuestion.options.map((opt, i) => (
                    <button
                      key={i}
                      className="ask-option-btn"
                      onClick={() => handleQuestionAnswer(opt, opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="ask-textarea"
                placeholder="或输入自定义回答..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const value = (e.target as HTMLTextAreaElement).value;
                    if (value.trim()) handleQuestionAnswer(value);
                  }
                }}
                rows={3}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
