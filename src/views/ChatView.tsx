import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import ChatHeader from '../components/ChatHeader';
import MessageList from '../components/MessageList';
import ChatInputBox from '../components/ChatInputBox';
import StatusPanel from '../components/StatusPanel';
import PermissionDialog from '../components/PermissionDialog';
import FullAccessConfirmDialog from '../components/FullAccessConfirmDialog';
import WelcomeScreen from '../components/WelcomeScreen';
import RewindDialog from '../components/RewindDialog';
import PlanApprovalDialog from '../components/PlanApprovalDialog';
import MessageAnchorRail from '../components/MessageAnchorRail';
import FileExplorer from '../components/FileExplorer';
import GeneratingResponseIndicator from '../components/GeneratingResponseIndicator';
import ContextUsageDialog, { type ContextUsageData } from '../components/ContextUsageDialog';
import { useDesktopChat } from '../hooks/useDesktopChat';
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
import { estimateMessagesUsedTokens, extractMessagesUsedTokens } from '../utils/contextUsage.js';
import { getDesktopEventSessionId, normalizeDesktopChatEvent } from '../utils/desktopChatEvents.js';
import {
  beginAbortWindow,
  completeAbortWindow,
  createQueuedChatMessage,
  queuedChatMessageToSendArgs,
  shouldQueueChatMessage,
  type AbortWindowState,
  type QueuedChatMessage,
} from '../utils/abortWindowState.js';
import { getContextUsage as loadContextUsage, type ContextUsageRequest } from '../utils/desktopBridgeApi';
import { getActiveSession, getSessions, loadSession, renameSession, setActiveSession } from '../utils/sessionBridgeApi';
import { deriveStatusData } from '../utils/statusPanelData';
import { useFileChangesManagement } from '../hooks/useFileChangesManagement';
import type {
  ChatMessage, Session, StatusData, PermissionRequest, PermissionMode,
  PlanApprovalRequest, AskUserQuestionRequest, SearchResult, SubAgentInfo, SubagentHistoryResponse, ImageBlock, AttachmentBlock
} from '../types';
import { isPermissionMode } from '../types';

interface ChatViewProps {
  routeSessionId?: string;
}

let msgIdCounter = 0;
function genId() { return `msg-${Date.now()}-${++msgIdCounter}`; }

function readStoredPreference(key: string, fallback: string) {
  const saved = localStorage.getItem(key);
  return saved && saved.trim() ? saved : fallback;
}

const CONTEXT_USAGE_STORAGE_PREFIX = 'chatContextUsage:';
const NEW_SESSION_COMMANDS = new Set(['/new', '/clear', '/reset']);
const RESUME_COMMANDS = new Set(['/resume', '/continue']);

function readStoredContextUsage(sessionId?: string) {
  if (!sessionId) return undefined;
  const saved = localStorage.getItem(`${CONTEXT_USAGE_STORAGE_PREFIX}${sessionId}`);
  const parsed = saved === null ? Number.NaN : Number.parseInt(saved, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function writeStoredContextUsage(sessionId: string | undefined, usedTokens: number) {
  if (!sessionId || !Number.isFinite(usedTokens) || usedTokens < 0) return;
  localStorage.setItem(`${CONTEXT_USAGE_STORAGE_PREFIX}${sessionId}`, String(Math.round(usedTokens)));
}

export default function ChatView({ routeSessionId }: ChatViewProps) {
  const { sessionId: routeParamSessionId } = useParams();
  const urlSessionId = routeSessionId ?? routeParamSessionId;
  const navigate = useNavigate();
  const location = useLocation();
  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const wasChatRouteRef = useRef(isChatRoute);
  const { send, incomingMessages, connected } = useDesktopChat();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stopping, setStopping] = useState<AbortWindowState | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [status, setStatus] = useState<StatusData>({});
  const [pendingModeConfirmation, setPendingModeConfirmation] = useState<PermissionMode | null>(null);
  const [mode, setModeState] = useState<PermissionMode>(() => {
    const saved = readStoredPreference('chatMode', 'default');
    return isPermissionMode(saved) ? saved : 'default';
  });
  const [model, setModelState] = useState(() => readStoredPreference('chatModel', 'default'));
  const [reasoning, setReasoningState] = useState(() => readStoredPreference('chatReasoning', 'high'));
  const [usageUsedTokens, setUsageUsedTokens] = useState<number | undefined>(undefined);
  const [contextUsage, setContextUsage] = useState<ContextUsageData | null>(null);
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const [contextUsageError, setContextUsageError] = useState('');
  const [runtimeLifecycle, setRuntimeLifecycle] = useState<{ classification: 'cold' | 'warm'; reason?: string } | null>(null);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [fileOpenRequest, setFileOpenRequest] = useState<{ path: string; requestId: number } | null>(null);

  useEffect(() => {
    const handlePreferenceChange = () => {
      const savedMode = readStoredPreference('chatMode', 'default');
      setModeState(isPermissionMode(savedMode) ? savedMode : 'default');
      setModelState(readStoredPreference('chatModel', 'default'));
      setReasoningState(readStoredPreference('chatReasoning', 'high'));
    };
    window.addEventListener('ccnexus:chat-preferences-changed', handlePreferenceChange);
    return () => window.removeEventListener('ccnexus:chat-preferences-changed', handlePreferenceChange);
  }, []);

  // P1 features state
  const [rewindTarget, setRewindTarget] = useState<ChatMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentSearchIdx, setCurrentSearchIdx] = useState(0);
  const [planApproval, setPlanApproval] = useState<PlanApprovalRequest | null>(null);
  const [askQuestion, setAskQuestion] = useState<AskUserQuestionRequest | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([]);
  const [subagentHistories, setSubagentHistories] = useState<Record<string, SubagentHistoryResponse>>({});

  // P2: Message queue state
  const [messageQueue, setMessageQueue] = useState<QueuedChatMessage[]>([]);
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
  const activeSessionIdRef = useRef<string | null>(urlSessionId ?? null);
  const historyRequestTokenRef = useRef(0);
  const processedIncomingMessageCountRef = useRef(0);
  const newSessionNavigationRef = useRef(false);
  // The server assigns the first session after the optimistic turn exists. Keep
  // that matching route update from being handled as a user session switch.
  const serverSessionNavigationRef = useRef<string | null>(null);

  const currentSessionId = urlSessionId ?? activeSessionIdRef.current ?? currentSession?.id ?? null;
  const {
    baseMessageIndex,
    processedFiles,
    handleUndoFile: markFileProcessed,
    handleKeepAll,
  } = useFileChangesManagement({
    currentSessionId,
    currentSessionIdRef: activeSessionIdRef,
    messages,
  });

  const applyMode = useCallback((nextMode: PermissionMode) => {
    setModeState(nextMode);
    localStorage.setItem('chatMode', nextMode);
    send({
      type: 'set_permission_mode',
      sessionId: currentSessionId,
      mode: nextMode,
    });
  }, [currentSessionId, send]);

  const setMode = useCallback((nextMode: PermissionMode) => {
    if (nextMode === 'bypassPermissions' && mode !== nextMode) {
      setPendingModeConfirmation(nextMode);
      return;
    }
    applyMode(nextMode);
  }, [applyMode, mode]);

  const confirmFullAccessMode = useCallback(() => {
    if (pendingModeConfirmation !== 'bypassPermissions') return;
    setPendingModeConfirmation(null);
    applyMode('bypassPermissions');
  }, [applyMode, pendingModeConfirmation]);

  const setModel = useCallback((nextModel: string) => {
    setModelState(nextModel);
    localStorage.setItem('chatModel', nextModel);
  }, []);

  const setReasoning = useCallback((nextReasoning: string) => {
    setReasoningState(nextReasoning);
    localStorage.setItem('chatReasoning', nextReasoning);
  }, []);

  const updateSessions = useCallback((updater: Session[] | ((previous: Session[]) => Session[])) => {
    setSessions(previous => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      sessionsRef.current = next;
      return next;
    });
  }, []);

  const rememberActiveSession = useCallback((sessionId: string | null) => {
    void setActiveSession(sessionId).catch(() => {});
  }, []);

  const contextUsageRequestRef = useRef(0);
  const handleContextUsage = useCallback(async (request: ContextUsageRequest) => {
    const requestId = ++contextUsageRequestRef.current;
    const sessionId = currentSession?.id ?? urlSessionId ?? undefined;
    setContextUsage(null);
    setContextUsageError('');
    setContextUsageLoading(true);
    try {
      const result = await loadContextUsage({ ...request, sessionId }) as ContextUsageData;
      if (requestId !== contextUsageRequestRef.current) return;
      if (sessionId && (currentSession?.id ?? urlSessionId ?? undefined) !== sessionId) return;
      setContextUsage(result);
    } catch (error) {
      if (requestId !== contextUsageRequestRef.current) return;
      setContextUsageError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === contextUsageRequestRef.current) setContextUsageLoading(false);
    }
  }, [currentSession?.id, urlSessionId]);

  useEffect(() => {
    contextUsageRequestRef.current += 1;
    setContextUsage(null);
    setContextUsageError('');
    setContextUsageLoading(false);
  }, [currentSession?.id, urlSessionId]);

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
  const handleUndoFileRequest = useCallback((filePath: string) => {
    if (!currentSession) return;
    send({
      type: 'undo_file',
      filePath,
      sessionId: currentSession.id,
    });
  }, [currentSession, send]);

  const handleDiscardAllFiles = useCallback((filePaths: string[]) => {
    if (!currentSession) return;
    filePaths.forEach(filePath => {
      send({
        type: 'undo_file',
        filePath,
        sessionId: currentSession.id,
      });
    });
  }, [currentSession, send]);

  const handleOpenFile = useCallback((filePath: string) => {
    setFileOpenRequest(previous => ({
      path: filePath,
      requestId: (previous?.requestId || 0) + 1,
    }));
  }, []);

  const handleSubagentHistory = useCallback((key: string, history: SubagentHistoryResponse) => {
    setSubagentHistories(previous => ({ ...previous, [key]: history }));
  }, []);

  // Plan approval handlers
  const handlePlanApprove = useCallback(() => {
    if (!planApproval) return;
    if (planApproval.responseType === 'permission') {
      send({
        type: 'permission_response',
        requestId: planApproval.requestId,
        behavior: 'allow',
        allow: true,
      });
      setPlanApproval(null);
      setMode('auto');
      return;
    }
    send({
      type: 'plan_approval_response',
      requestId: planApproval.requestId,
      approved: true,
      targetMode: 'auto',
    });
    setPlanApproval(null);
  }, [planApproval, send, setMode]);

  const handlePlanReject = useCallback((feedback: string) => {
    if (!planApproval) return;
    if (planApproval.responseType === 'permission') {
      send({
        type: 'permission_response',
        requestId: planApproval.requestId,
        behavior: 'deny',
        allow: false,
      });
      setPlanApproval(null);
      return;
    }
    send({
      type: 'plan_approval_response',
      requestId: planApproval.requestId,
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

  // Match ccgui's beginSessionTransition: invalidate the outgoing history
  // request and clear every transient value before the next session is loaded.
  const beginSessionTransition = useCallback((nextSessionId: string | null, nextSession: Session | null = null) => {
    historyRequestTokenRef.current += 1;
    activeSessionIdRef.current = nextSessionId;
    requestedHistorySessionRef.current = null;
    resetStreamingBlockState(streamingBlocksRef.current);
    streamingMsgRef.current = null;
    setIsStreaming(false);
    setStopping(null);
    setMessages([]);
    setUsageUsedTokens(undefined);
    setCurrentSession(nextSessionId ? nextSession : null);
    setPermission(null);
    setPendingModeConfirmation(null);
    setPlanApproval(null);
    setAskQuestion(null);
    setRewindTarget(null);
    setSubAgents([]);
    setSubagentHistories({});
    setStatus({});
    setMessageQueue([]);
    setStatus({});
    setRuntimeLifecycle(null);
  }, []);

  const applySessionHistory = useCallback((history: { sessionId: string; messages: ChatMessage[] }) => {
    if (urlSessionId && urlSessionId !== history.sessionId) return;
    if (activeSessionIdRef.current !== history.sessionId) return;
    requestedHistorySessionRef.current = history.sessionId;
    resetStreamingBlockState(streamingBlocksRef.current);
    streamingMsgRef.current = null;
    setIsStreaming(false);
    setMessages(history.messages);
    setUsageUsedTokens(extractMessagesUsedTokens(history.messages) ?? readStoredContextUsage(history.sessionId) ?? estimateMessagesUsedTokens(history.messages));
    setCurrentSession(prev => prev?.id === history.sessionId
      ? prev
      : sessionsRef.current.find(session => session.id === history.sessionId) || {
        id: history.sessionId,
        title: 'New Chat',
        updatedAt: Date.now(),
      });
  }, [urlSessionId]);

  const requestSessionHistory = useCallback((sessionId: string, fallbackSessionId: string | null = null) => {
    const requestToken = ++historyRequestTokenRef.current;
    activeSessionIdRef.current = sessionId;
    requestedHistorySessionRef.current = sessionId;
    void loadSession(sessionId)
      .then(history => {
        if (
          historyRequestTokenRef.current !== requestToken
          || activeSessionIdRef.current !== history.sessionId
          || requestedHistorySessionRef.current !== history.sessionId
        ) return;
        applySessionHistory(history);
      })
      .catch(() => {
        if (historyRequestTokenRef.current === requestToken
          && requestedHistorySessionRef.current === sessionId) {
          requestedHistorySessionRef.current = null;
          if (fallbackSessionId) {
            const fallbackSession = sessionsRef.current.find(session => session.id === fallbackSessionId);
            if (fallbackSession) {
              beginSessionTransition(fallbackSession.id, fallbackSession);
              setCurrentSession(fallbackSession);
              rememberActiveSession(fallbackSession.id);
              requestSessionHistory(fallbackSession.id);
            }
          }
        }
      });
  }, [applySessionHistory, beginSessionTransition, rememberActiveSession]);

  const applySessionList = useCallback((sessionList: Session[], deletedSessionIds: string[] = [], preferredSessionId: string | null = null) => {
    sessionsRef.current = sessionList;
    updateSessions(sessionList);
    if (urlSessionId && deletedSessionIds.includes(urlSessionId)) {
      beginSessionTransition(null);
      setCurrentSession(null);
      rememberActiveSession(null);
      navigate('/chat', { replace: true });
      return;
    }
    if (urlSessionId) {
      const s = sessionList.find(x => x.id === urlSessionId);
      if (s) {
        setCurrentSession(s);
        rememberActiveSession(s.id);
      }
    } else if (newSessionNavigationRef.current) {
      newSessionNavigationRef.current = false; // 保持空白新会话，不自动选择
    } else if (sessionList.length > 0) {
      const preferredSession = preferredSessionId
        ? sessionList.find(session => session.id === preferredSessionId)
        : undefined;
      const latest = [...sessionList].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const nextSession = preferredSession || latest;
      if (activeSessionIdRef.current !== nextSession.id) {
        beginSessionTransition(nextSession.id, nextSession);
      } else {
        setCurrentSession(nextSession);
      }
      rememberActiveSession(nextSession.id);
      if (requestedHistorySessionRef.current !== nextSession.id) {
        const fallbackSessionId = preferredSession && preferredSession.id !== latest.id
          ? latest.id
          : null;
        requestSessionHistory(nextSession.id, fallbackSessionId);
      }
    }
  }, [beginSessionTransition, navigate, rememberActiveSession, requestSessionHistory, updateSessions, urlSessionId]);

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

  const refreshSessions = useCallback(async () => {
    const [event, activeSession] = await Promise.all([
      getSessions(),
      getActiveSession().catch(() => ({ sessionId: null })),
    ]);
    applySessionList(event.sessions, event.deletedSessionIds, activeSession.sessionId);
  }, [applySessionList]);

  // Initialize from the last active session stored by the desktop runtime.
  useEffect(() => {
    void refreshSessions().catch(() => applySessionList([]));
  }, [applySessionList, refreshSessions]);

  // Reconcile against the authoritative session list when the chat route
  // becomes visible again with no session id. Returning from /history lands on
  // /chat (no id), where urlSessionId is undefined before and after, so the
  // URL-change effect never fires and stale state would otherwise persist.
  useEffect(() => {
    const wasChatRoute = wasChatRouteRef.current;
    wasChatRouteRef.current = isChatRoute;
    if (!wasChatRoute && isChatRoute && !urlSessionId) {
      void refreshSessions().catch(() => applySessionList([]));
    }
  }, [applySessionList, isChatRoute, refreshSessions, urlSessionId]);

  // Handle URL session change
  useEffect(() => {
    if (urlSessionId) {
      if (serverSessionNavigationRef.current === urlSessionId) {
        serverSessionNavigationRef.current = null;
        historyRequestTokenRef.current += 1;
        activeSessionIdRef.current = urlSessionId;
        requestedHistorySessionRef.current = null;
        const targetSession = sessionsRef.current.find(session => session.id === urlSessionId);
        setCurrentSession(prev => prev?.id === urlSessionId ? prev : targetSession || {
          id: urlSessionId,
          title: 'New Chat',
          updatedAt: Date.now(),
        });
        rememberActiveSession(urlSessionId);
        return;
      }
      // A different route is a real navigation, not the server-assigned route
      // we were waiting to consume. Disarm the old one before this switch so it
      // cannot suppress a later genuine navigation back to that stale ID.
      serverSessionNavigationRef.current = null;
      if (activeSessionIdRef.current !== urlSessionId) {
        const targetSession = sessionsRef.current.find(session => session.id === urlSessionId);
        beginSessionTransition(urlSessionId, targetSession || {
          id: urlSessionId,
          title: 'New Chat',
          updatedAt: Date.now(),
        });
        setCurrentSession(targetSession || {
          id: urlSessionId,
          title: 'New Chat',
          updatedAt: Date.now(),
        });
      }
      rememberActiveSession(urlSessionId);
      if (requestedHistorySessionRef.current !== urlSessionId) {
        requestSessionHistory(urlSessionId);
      }
    }
  }, [beginSessionTransition, rememberActiveSession, requestSessionHistory, urlSessionId]);

  // Handle desktop chat events
  useEffect(() => {
    const nextMessages = incomingMessages.slice(processedIncomingMessageCountRef.current);
    processedIncomingMessageCountRef.current = incomingMessages.length;

    for (const rawMessage of nextMessages) {
      const msg = normalizeDesktopChatEvent(rawMessage) as typeof rawMessage;
      const activeSessionId = activeSessionIdRef.current ?? urlSessionId ?? currentSession?.id ?? null;
      const eventSessionId = getDesktopEventSessionId(msg);
      const globalEvent = msg.type === 'session_list'
        || msg.type === 'session_created'
        || msg.type === 'session_deleted'
        || msg.type === 'session_renamed'
        || (msg.type === 'error' && !eventSessionId);
      const establishesSession = msg.type === 'session' && !activeSessionId;
      // Global unlock events must clear a stuck abort window even when their
      // session id no longer matches the active session (e.g. the session was
      // just deleted), so they skip the session boundary filter below.
      const unlockEvent = (msg.type === 'status' && msg.status === 'idle' && msg.reason === 'abort-complete')
        || (msg.type === 'error' && msg.invalidSessionId);

      // ccgui drops callbacks belonging to the outgoing channel while a new
      // session is loading. Desktop IPC is ordered, but old SDK queries can
      // still unwind later, so apply the same session boundary here.
      if (!globalEvent && !unlockEvent && eventSessionId && (!activeSessionId || eventSessionId !== activeSessionId) && !establishesSession) {
        continue;
      }

      switch (msg.type) {
      case 'session': {
        if (activeSessionId && activeSessionId !== msg.sessionId) break;
        activeSessionIdRef.current = msg.sessionId;
        const knownSession = sessionsRef.current.find(item => item.id === msg.sessionId);
        const sessionTitle = msg.title?.trim() || knownSession?.title || currentSession?.title || 'New Chat';
        const sessionUpdatedAt = Number.isFinite(msg.updatedAt)
          ? msg.updatedAt as number
          : knownSession?.updatedAt || Date.now();
        const session: Session = {
          id: msg.sessionId,
          title: sessionTitle,
          updatedAt: sessionUpdatedAt,
        };
        updateSessions(prev => {
          const existing = prev.find(item => item.id === msg.sessionId);
          return existing
            ? prev.map(item => item.id === msg.sessionId ? { ...item, ...session } : item)
            : [...prev, session];
        });
        rememberActiveSession(msg.sessionId);
        if (!currentSession) {
          setCurrentSession(session);
          // Do not leave a guard behind when the canonical session event already
          // matches the route (for example, after a direct URL load). A stale
          // guard could otherwise suppress a later real session switch.
          if (urlSessionId !== msg.sessionId) {
            serverSessionNavigationRef.current = msg.sessionId;
            navigate(`/chat/${msg.sessionId}`, { replace: true });
          }
        } else if (currentSession.id === msg.sessionId) {
          setCurrentSession(session);
        }
        break;
      }
      case 'session_list': {
        applySessionList(msg.sessions, msg.deletedSessionIds);
        break;
      }
      case 'session_created': {
        const active = activeSessionIdRef.current;
        if (active && active !== msg.session.id) break;
        activeSessionIdRef.current = msg.session.id;
        updateSessions(prev => prev.some(session => session.id === msg.session.id)
          ? prev.map(session => session.id === msg.session.id ? msg.session : session)
          : [msg.session, ...prev]);
        setCurrentSession(msg.session);
        rememberActiveSession(msg.session.id);
        navigate(`/chat/${msg.session.id}`, { replace: true });
        break;
      }
      case 'session_deleted': {
        updateSessions(prev => prev.filter(s => s.id !== msg.sessionId));
        if (activeSessionIdRef.current === msg.sessionId || currentSession?.id === msg.sessionId) {
          activeSessionIdRef.current = null;
          rememberActiveSession(null);
          setCurrentSession(null);
          setMessages([]);
          navigate('/chat', { replace: true });
        }
        break;
      }
      case 'session_renamed': {
        updateSessions(prev => prev.map(s => s.id === msg.session_id ? { ...s, title: msg.title } : s));
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
          sessionId: msg.message.sessionId ?? msg.sessionId,
          model: msg.message.model,
          usage: msg.message.usage,
          runtimeClassification: msg.message.runtimeClassification,
          runtimeRetirementReason: msg.message.runtimeRetirementReason,
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
        const toolUseId = msg.toolUseId ?? msg.tool_use_id;
        if (!toolUseId) break;
        const resultBlock = { type: 'tool_result' as const, tool_use_id: toolUseId, content: msg.content, is_error: msg.is_error };
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
        if (msg.toolName === 'ExitPlanMode') {
          const input = msg.input || {};
          const plan = typeof input.plan === 'string'
            ? input.plan
            : JSON.stringify(input, null, 2);
          const allowedPrompts = Array.isArray(input.allowedPrompts)
            ? input.allowedPrompts.filter(item => (
              item
              && typeof item.tool === 'string'
              && typeof item.prompt === 'string'
            )) as { tool: string; prompt: string }[]
            : [];
          setPermission(null);
          setPlanApproval({
            requestId: msg.requestId,
            toolName: msg.toolName,
            plan,
            allowedPrompts,
            responseType: 'permission',
          });
          break;
        }
        setPermission({ permission_id: msg.requestId, tool_name: msg.toolName, input: msg.input });
        break;
      }
      case 'session_history': {
        applySessionHistory({ sessionId: msg.sessionId, messages: msg.messages });
        break;
      }

      case 'status': {
        if (msg.status === 'idle') {
          setStopping(current => completeAbortWindow(current, msg));
          finishStreamingMessage();
        }
        break;
      }

      case 'usage_update': {
        const usageSessionId = msg.sessionId ?? currentSession?.id ?? urlSessionId;
        const activeSessionId = activeSessionIdRef.current ?? currentSession?.id ?? urlSessionId;
        if (usageSessionId && activeSessionId && usageSessionId !== activeSessionId) break;
        setUsageUsedTokens(msg.usedTokens);
        writeStoredContextUsage(usageSessionId, msg.usedTokens);
        break;
      }

      case 'runtime_lifecycle': {
        const lifecycleSessionId = msg.sessionId ?? currentSession?.id ?? urlSessionId;
        const activeLifecycleSessionId = activeSessionIdRef.current ?? currentSession?.id ?? urlSessionId;
        if (lifecycleSessionId && activeLifecycleSessionId && lifecycleSessionId !== activeLifecycleSessionId) break;
        setRuntimeLifecycle({ classification: msg.classification, reason: msg.reason });
        break;
      }

      case 'result': {
        finishStreamingMessage();
        break;
      }

      case 'error': {
        finishStreamingMessage();
        if (msg.invalidSessionId) {
          updateSessions(prev => prev.filter(session => session.id !== msg.invalidSessionId));
          if (currentSession?.id === msg.invalidSessionId) {
            rememberActiveSession(null);
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
        setPermission(null);
        setPlanApproval({
          requestId: msg.requestId,
          toolName: msg.toolName,
          plan: msg.plan,
          allowedPrompts: msg.allowedPrompts,
          responseType: 'plan',
        });
        break;
      }

      case 'mode_changed': {
        if (isPermissionMode(msg.mode)) {
          setModeState(msg.mode);
          localStorage.setItem('chatMode', msg.mode);
        }
        break;
      }

      case 'ask_user_question': {
        setAskQuestion({
          question_id: msg.questionId,
          question: msg.question,
          options: msg.options,
          context: msg.context,
          tool_use_id: msg.toolUseId,
        });
        break;
      }

      case 'subagent_update': {
        setSubAgents(msg.agents);
        setStatus(prev => ({ ...prev, subagents: msg.agents }));
        break;
      }

      case 'rewind_complete': {
        setMessages(msg.messages);
        setUsageUsedTokens(extractMessagesUsedTokens(msg.messages) ?? estimateMessagesUsedTokens(msg.messages));
        break;
      }

      case 'undo_complete': {
        if (msg.success && msg.filePath) {
          markFileProcessed(msg.filePath);
        }
          break;
        }
      }
    }
  }, [incomingMessages, urlSessionId, navigate, currentSession, finishStreamingMessage, applySessionList, applySessionHistory, markFileProcessed, rememberActiveSession, updateSessions]);

  const handleNewSession = useCallback(() => {
    if (isStreaming && currentSession?.id) {
      send({ type: 'abort', sessionId: currentSession.id });
    }
    newSessionNavigationRef.current = true;
    rememberActiveSession(null);
    beginSessionTransition(null);
    navigate('/chat', { replace: true });
    send({ type: 'new_session' });
  }, [beginSessionTransition, currentSession, isStreaming, navigate, rememberActiveSession, send]);

  const handleOpenHistory = useCallback(() => {
    if (isStreaming) {
      send({ type: 'abort', sessionId: currentSession?.id });
      finishStreamingMessage();
    }
    navigate('/history');
  }, [currentSession, finishStreamingMessage, isStreaming, navigate, send]);

  const handleSend = useCallback((text: string, attachments: { type: string; data: string; described?: boolean; name?: string; mediaType?: string }[] = [], queue: boolean = false, reasoningEffort?: string, agent?: string, streaming?: boolean, alwaysThinking?: boolean, modelOverride?: string, displayText?: string) => {
    if (!text.trim() && attachments.length === 0) return;

    if (attachments.length === 0) {
      const command = text.trim().split(/\s+/)[0]?.toLowerCase();
      if (NEW_SESSION_COMMANDS.has(command)) {
        handleNewSession();
        return;
      }
      if (RESUME_COMMANDS.has(command)) {
        handleOpenHistory();
        return;
      }
      if (command === '/plan') {
        setMode('plan');
        return;
      }
    }

    // If AI is streaming and queue is requested, add to queue
    if (shouldQueueChatMessage({ isStreaming, stopping }) && queue) {
      const queuedMsg: QueuedChatMessage = createQueuedChatMessage({
        id: genId(),
        text: text.trim(),
        timestamp: Date.now(),
        attachments,
        reasoningEffort,
        agent,
        streaming,
        alwaysThinking,
        modelOverride,
        displayText,
      });
      setMessageQueue(prev => [...prev, queuedMsg]);
      return;
    }

    // If AI is streaming but not queued, still add to queue
    if (shouldQueueChatMessage({ isStreaming, stopping })) {
      const queuedMsg: QueuedChatMessage = createQueuedChatMessage({
        id: genId(),
        text: text.trim(),
        timestamp: Date.now(),
        attachments,
        reasoningEffort,
        agent,
        streaming,
        alwaysThinking,
        modelOverride,
        displayText,
      });
      setMessageQueue(prev => [...prev, queuedMsg]);
      return;
    }

    const imageBlocks: ImageBlock[] = attachments
      .filter(attachment => attachment.type !== 'file')
      .map(attachment => ({
        type: 'image' as const,
        src: attachment.data,
        alt: 'Uploaded image',
        described: attachment.described,
      }));
    const attachmentBlocks: AttachmentBlock[] = attachments
      .filter(attachment => attachment.type === 'file')
      .map(attachment => ({
        type: 'attachment' as const,
        fileName: attachment.name,
        mediaType: attachment.mediaType,
        path: attachment.data,
      }));
    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: [{ type: 'text', text: (displayText ?? text).trim() }, ...imageBlocks, ...attachmentBlocks],
      timestamp: Date.now(),
      sessionId: currentSession?.id,
    };
    setSubAgents([]);
    setSubagentHistories({});
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
      images: attachments.filter(a => a.type !== 'file' && !a.described).map(a => ({ type: a.type, data: a.data })),
      options: {
        mode, 
        model: modelOverride || model, 
        reasoning: reasoningEffort || reasoning,
        agent,
        streaming,
        alwaysThinking,
      },
    });
  }, [beginSessionTransition, currentSession, finishStreamingMessage, handleNewSession, handleOpenHistory, isStreaming, mode, model, navigate, reasoning, send, setMode, stopping]);

  // Process message queue when streaming completes
  useEffect(() => {
    if (!isStreaming && !stopping && messageQueue.length > 0 && !queueProcessingRef.current) {
      queueProcessingRef.current = true;
      const nextMsg = messageQueue[0];
      setMessageQueue(prev => prev.slice(1));
      
      // Send the queued message
      setTimeout(() => {
        handleSend(...queuedChatMessageToSendArgs(nextMsg));
        queueProcessingRef.current = false;
      }, 100);
    }
  }, [isStreaming, stopping, messageQueue, handleSend]);

  // Queue management
  const removeFromQueue = useCallback((id: string) => {
    setMessageQueue(prev => prev.filter(m => m.id !== id));
  }, []);

  const updateQueuedMessage = useCallback((id: string, text: string) => {
    setMessageQueue(prev => prev.map(m => (m.id === id ? { ...m, text } : m)));
  }, []);

  const clearQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);

  const handleStop = useCallback(() => {
    const sessionId = currentSession?.id ?? activeSessionIdRef.current ?? null;
    setStopping(beginAbortWindow(sessionId));
    send({ type: 'abort', sessionId });
    finishStreamingMessage();
  }, [send, currentSession, finishStreamingMessage]);

  const handleRenameSession = useCallback((title: string) => {
    if (currentSession) {
      void renameSession(currentSession.id, title)
        .then(event => {
          updateSessions(prev => prev.map(s => s.id === event.session_id ? { ...s, title: event.title } : s));
          setCurrentSession(prev => prev ? { ...prev, title: event.title } : prev);
        });
    }
  }, [currentSession, updateSessions]);

  const handlePermission = useCallback((permissionId: string, behavior: 'allow' | 'deny' | 'always_allow') => {
    send({ type: 'permission_response', requestId: permissionId, behavior, allow: behavior !== 'deny' });
    setPermission(null);
  }, [send]);

  // Keep the bottom status panel derived from the active session messages.
  useEffect(() => {
    const derived = deriveStatusData(messages, { startFromIndex: baseMessageIndex, processedFiles });
    setStatus(prev => ({
      ...prev,
      tasks: derived.tasks,
      edits: derived.edits,
      subagents: subAgents.length > 0 ? subAgents : derived.subagents,
    }));
  }, [baseMessageIndex, messages, processedFiles, subAgents]);

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

  const handleWorkspaceChanged = useCallback(() => {
    newSessionNavigationRef.current = false;
    beginSessionTransition(null);
    setFileOpenRequest(null);
    serverSessionNavigationRef.current = null;
    setCurrentSession(null);
    updateSessions([]);
    setWorkspaceVersion((version) => version + 1);
    send({ type: 'new_session' });
    navigate('/chat', { replace: true });
    void refreshSessions().catch(() => applySessionList([]));
  }, [applySessionList, beginSessionTransition, navigate, refreshSessions, send, updateSessions]);

  const handleOpenProject = useCallback(async () => {
    const desktopApi = window.ccNexusDesktop;
    if (!desktopApi?.openProject) return;
    const project = await desktopApi.openProject();
    if (!project || project.canceled || !project.path) return;
    handleWorkspaceChanged();
  }, [handleWorkspaceChanged]);

  return (
    <div className="chat-view">
      <FileExplorer key={workspaceVersion} onWorkspaceChange={handleWorkspaceChanged} openFileRequest={fileOpenRequest} />
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
          onOpenProject={handleOpenProject}
          onOpenHistory={handleOpenHistory}
        />
        <div className="chat-main">
          {messages.length === 0 ? (
            <WelcomeScreen onSuggestion={handleSend} />
          ) : (
            <div className="chat-content-with-rail">
              <MessageList
                messages={messages}
                isStreaming={isStreaming}
                queuedMessages={messageQueue}
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
        {showStatusPanel && (
          <StatusPanel
            status={status}
            onUndoFile={handleUndoFileRequest}
            onOpenFile={handleOpenFile}
            onDiscardAllFiles={handleDiscardAllFiles}
            onKeepAllFiles={handleKeepAll}
            subagentHistories={subagentHistories}
            onSubagentHistory={handleSubagentHistory}
            sessionId={currentSession?.id ?? urlSessionId ?? null}
            isStreaming={isStreaming}
          />
        )}
        <ChatInputBox
          onSend={handleSend}
          onContextUsage={handleContextUsage}
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
          onProviderSwitch={handleNewSession}
          usageUsedTokens={usageUsedTokens}
          queue={messageQueue}
          onRemoveQueued={removeFromQueue}
          onUpdateQueued={updateQueuedMessage}
          onClearQueued={clearQueue}
          sessionKey={currentSession?.id ?? urlSessionId ?? null}
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
      {pendingModeConfirmation === 'bypassPermissions' && (
        <FullAccessConfirmDialog
          onConfirm={confirmFullAccessMode}
          onCancel={() => setPendingModeConfirmation(null)}
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
      <ContextUsageDialog
        isOpen={contextUsageLoading || Boolean(contextUsage) || Boolean(contextUsageError)}
        isLoading={contextUsageLoading}
        data={contextUsage}
        error={contextUsageError}
        onClose={() => {
          contextUsageRequestRef.current += 1;
          setContextUsageLoading(false);
          setContextUsage(null);
          setContextUsageError('');
        }}
      />
    </div>
  );
}
