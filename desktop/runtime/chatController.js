import { promises as fs } from 'node:fs';
import { assistantEvent, permissionRequestEvent, sessionEvent, streamEvent } from '../../server/protocol.js';
import { createAssistantTurn } from '../../server/assistantTurn.js';
import { buildClaudeQueryOptions } from '../../server/queryOptions.js';
import { createPermissionPolicy } from '../../server/permissionPolicy.js';
import { isMissingClaudeConversationError, staleSessionErrorEvent } from '../../server/sessionRecovery.js';
import { extractToolResults } from '../../server/toolResults.js';
import { createUsageUpdate, extractUsageFromSdkEvent } from '../../src/utils/contextUsage.js';
import { buildClaudeClientOptions } from '../../server/claudeRequestContext.js';

function promptTitle(prompt) {
  return (prompt || '').slice(0, 60) || 'Untitled chat';
}

function createPendingId() {
  return Math.random().toString(36).slice(2, 12);
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export function createDesktopChatController({ runtime, sessions, localConfig, workspaceFiles }) {
  let currentSessionId = null;
  let latestChatRequest = 0;
  const ownedQueries = new Map();
  const latestRequestBySession = new Map();
  const pendingPermissions = new Map();
  const pendingPlanApprovals = new Map();
  const pendingUserQuestions = new Map();
  const sessionMessages = new Map();
  const fileEditHistory = new Map();

  function emitSafe(emit, payload) {
    try {
      emit(payload);
    } catch {
      // The renderer may have gone away while Claude is still unwinding.
    }
  }

  function registerActiveQuery(sessionId, query) {
    if (!sessionId || !query) return;
    ownedQueries.set(sessionId, query);
    runtime.registerChannel({ sessionId, query });
  }

  function unregisterActiveQuery(sessionId, query) {
    if (!sessionId) return;
    if (!query || ownedQueries.get(sessionId) === query) {
      ownedQueries.delete(sessionId);
    }
    runtime.unregisterChannel({ sessionId, query });
  }

  async function stopOwnedQuery(sessionId) {
    const query = ownedQueries.get(sessionId);
    if (!query) return false;
    try { await query.interrupt(); } catch { /* ignore */ }
    try { query.close(); } catch { /* ignore */ }
    unregisterActiveQuery(sessionId, query);
    if (currentSessionId === sessionId) currentSessionId = null;
    return true;
  }

  function forgetSessionState(sessionId) {
    sessionMessages.delete(sessionId);
    fileEditHistory.delete(sessionId);
    ownedQueries.delete(sessionId);
    runtime.removeSessionDaemon(sessionId);
  }

  function requestPermissionFromRenderer(emit, toolName, input, options, sessionId) {
    const requestId = createPendingId();
    return new Promise((resolve) => {
      pendingPermissions.set(requestId, { resolve, toolName, input });
      emitSafe(emit, permissionRequestEvent({
        requestId,
        toolName,
        input,
        sessionId,
        title: options?.title || `Allow ${toolName}?`,
        displayName: options?.displayName || toolName,
      }));
      setTimeout(() => {
        if (!pendingPermissions.has(requestId)) return;
        pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
      }, 300000);
    });
  }

  function createPermissionHandler(emit, getSessionId) {
    const policy = createPermissionPolicy({
      askUser: (toolName, input, options) => requestPermissionFromRenderer(emit, toolName, input, options, getSessionId?.()),
    });
    return policy.canUseTool;
  }

  async function loadMessages(sessionId) {
    if (sessionMessages.has(sessionId)) return sessionMessages.get(sessionId);
    const history = await sessions.loadSession(sessionId);
    const messages = Array.isArray(history.messages) ? history.messages : [];
    sessionMessages.set(sessionId, messages);
    return messages;
  }

  async function recordUserMessage(sessionId, prompt) {
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      sessionId,
      timestamp: Date.now(),
    };
    await sessions.appendMessage(sessionId, userMessage);
    sessionMessages.delete(sessionId);
    await loadMessages(sessionId);
  }

  async function recordAssistantMessage(sessionId, assistantMessage) {
    const message = {
      ...assistantMessage,
      role: 'assistant',
      timestamp: Date.now(),
    };
    await sessions.appendMessage(sessionId, message);
    sessionMessages.delete(sessionId);
    await loadMessages(sessionId);
  }

  async function rememberEditableFile(sessionId, block) {
    if (block?.type !== 'tool_use' || !['Edit', 'MultiEdit', 'Write'].includes(block.name)) return;
    const filePath = block.input?.file_path || block.input?.path;
    const absPath = filePath && workspaceFiles.safePath(filePath);
    if (!absPath) return;
    if (workspaceFiles.isProtectedWorkspacePath?.(absPath)) return;
    if (!fileEditHistory.has(sessionId)) fileEditHistory.set(sessionId, new Map());
    const history = fileEditHistory.get(sessionId);
    if (history.has(absPath)) return;
    try {
      history.set(absPath, await fs.readFile(absPath, 'utf-8'));
    } catch {
      history.set(absPath, '');
    }
  }

  async function handleChat(message, emit) {
    const { text, images, sessionId, options: clientOptions } = message;
    let querySessionId = sessionId || null;
    const requestOrder = ++latestChatRequest;
    currentSessionId = querySessionId;
    if (querySessionId) latestRequestBySession.set(querySessionId, requestOrder);

    let prompt = text || '';
    if (Array.isArray(images) && images.length) {
      prompt += '\n\n[User attached images]';
    }

    const canUseTool = createPermissionHandler(emit, () => querySessionId);
    const { currentEnv } = await localConfig.getProviders();
    const queryEnv = { ...process.env, ...(currentEnv || {}) };
    const effectiveClientOptions = await buildClaudeClientOptions({
      cwd: workspaceFiles.getWorkspace().cwd,
      clientOptions,
      loadAgent: (name) => localConfig.getAgent(name, workspaceFiles.getWorkspace().cwd),
    });
    const modelForUsage = clientOptions?.model && clientOptions.model !== 'default'
      ? clientOptions.model
      : 'claude-sonnet-4-6';
    const queryOpts = buildClaudeQueryOptions({
      cwd: workspaceFiles.getWorkspace().cwd,
      env: queryEnv,
      canUseTool,
      clientOptions: effectiveClientOptions,
    });
    if (querySessionId) queryOpts.resume = querySessionId;

    emitSafe(emit, { type: 'status', status: 'thinking', sessionId: querySessionId });

    let query;
    try {
      query = await runtime.queryClaude({
        sessionId: querySessionId || `pending-${requestOrder}`,
        title: promptTitle(prompt),
        prompt,
        options: queryOpts,
        onPermissionRequest: (request) => canUseTool(request.toolName, request.input, request.options),
      });

      const assistantTurn = createAssistantTurn();
      let lastAssistantId = null;

      queryEvents: for await (const event of query) {
        const usage = extractUsageFromSdkEvent(event);
        if (usage) {
          assistantTurn.addUsage(usage);
          emitSafe(emit, createUsageUpdate({
            usage,
            provider: 'claude',
            model: modelForUsage,
            sessionId: event.session_id || querySessionId,
          }));
        }

        switch (event.type) {
          case 'system': {
            if (event.subtype === 'init') {
              querySessionId = event.session_id || querySessionId;
              if (latestRequestBySession.has(querySessionId)
                && latestRequestBySession.get(querySessionId) !== requestOrder) {
                try { query.close(); } catch { /* ignore */ }
                unregisterActiveQuery(querySessionId, query);
                break queryEvents;
              }
              latestRequestBySession.set(querySessionId, requestOrder);
              if (requestOrder === latestChatRequest) currentSessionId = querySessionId;
              runtime.adoptSessionDaemon({
                fromSessionId: query.daemonSessionId,
                toSessionId: querySessionId,
                title: promptTitle(prompt),
              });
              runtime.ensureSessionDaemon({ sessionId: querySessionId, title: promptTitle(prompt) });
              registerActiveQuery(querySessionId, query);
              const savedSession = await sessions.saveSession({
                id: querySessionId,
                title: promptTitle(prompt),
                updatedAt: Date.now(),
              });
              if (typeof workspaceFiles.setActiveSessionId === 'function') {
                await workspaceFiles.setActiveSessionId(querySessionId).catch(() => {});
              }
              emitSafe(emit, sessionEvent(querySessionId, savedSession));
              await recordUserMessage(querySessionId, prompt);
            }
            emitSafe(emit, { type: 'system', subtype: event.subtype, sessionId: event.session_id || querySessionId });
            break;
          }

          case 'stream_event':
            assistantTurn.addStreamEvent(event.event);
            emitSafe(emit, streamEvent(event.event, event.session_id || querySessionId, event.uuid));
            break;

          case 'assistant':
            assistantTurn.add(event.message);
            lastAssistantId = event.uuid || lastAssistantId;
            break;

          case 'user':
            for (const result of extractToolResults(event.message)) {
              assistantTurn.addToolResult(result);
              emitSafe(emit, {
              ...result,
                sessionId: event.session_id || querySessionId,
                uuid: event.uuid,
              });
            }
            break;

          case 'result': {
            const finalSessionId = event.session_id || querySessionId;
            const finalAssistant = event.is_error ? null : assistantTurn.complete({
              id: lastAssistantId || `msg-${Date.now()}`,
              sessionId: finalSessionId,
            });
            if (finalAssistant) {
              await recordAssistantMessage(finalSessionId, finalAssistant);
              for (const block of finalAssistant.content) {
                await rememberEditableFile(finalSessionId, block);
              }
              emitSafe(emit, assistantEvent(finalAssistant));
            }
            emitSafe(emit, {
              type: 'result',
              subtype: event.subtype,
              duration: event.duration_ms,
              cost: event.total_cost_usd,
              turns: event.num_turns,
              is_error: event.is_error,
              sessionId: finalSessionId,
            });
            emitSafe(emit, { type: 'status', status: 'idle', sessionId: finalSessionId });
            break;
          }

          case 'tool_progress':
            emitSafe(emit, {
              type: 'tool_progress',
              toolName: event.tool_name,
              toolUseId: event.tool_use_id,
              elapsed: event.elapsed_time_seconds,
              sessionId: event.session_id || querySessionId,
            });
            break;

          case 'tool_use_summary':
            emitSafe(emit, {
              type: 'tool_use_summary',
              summary: event.summary,
              precedingIds: event.preceding_tool_use_ids,
              sessionId: event.session_id || querySessionId,
            });
            break;

          default:
            if (event.type && event.type !== 'system') {
              emitSafe(emit, { type: 'sdk_event', sdkType: event.type, sessionId: event.session_id || querySessionId });
            }
            break;
        }
      }
    } catch (error) {
      const messageText = normalizeError(error);
      let invalidSessionId = null;
      if (querySessionId && isMissingClaudeConversationError(messageText)) {
        await sessions.deleteSession(querySessionId);
        forgetSessionState(querySessionId);
        if (currentSessionId === querySessionId) currentSessionId = null;
        invalidSessionId = querySessionId;
      }
      emitSafe(emit, invalidSessionId
        ? staleSessionErrorEvent(messageText, invalidSessionId)
        : { type: 'error', message: messageText, sessionId: querySessionId });
      emitSafe(emit, { type: 'status', status: 'idle', sessionId: querySessionId });
    } finally {
      if (querySessionId) unregisterActiveQuery(querySessionId, query);
    }
  }

  async function getContextUsage({ sessionId = null, model = 'default' } = {}) {
    const workspace = workspaceFiles.getWorkspace();
    const { currentEnv } = await localConfig.getProviders();
    const queryEnv = { ...process.env, ...(currentEnv || {}) };
    const clientOptions = await buildClaudeClientOptions({
      cwd: workspace.cwd,
      clientOptions: { model },
      loadAgent: (name) => localConfig.getAgent(name, workspace.cwd),
    });
    const queryOptions = buildClaudeQueryOptions({
      cwd: workspace.cwd,
      env: queryEnv,
      clientOptions,
    });
    if (sessionId) queryOptions.resume = sessionId;
    return runtime.getContextUsage({
      sessionId,
      title: 'Context usage',
      options: queryOptions,
    });
  }

  async function handle(message, emit) {
    switch (message?.type) {
      case 'chat':
        await handleChat(message, emit);
        break;

      case 'permission_response': {
        const { requestId, allow, behavior, message: responseMessage } = message;
        const pending = pendingPermissions.get(requestId);
        if (!pending) break;
        pendingPermissions.delete(requestId);
        const decision = behavior || (allow ? 'allow' : 'deny');
        pending.resolve(decision === 'deny'
          ? { behavior: 'deny', message: responseMessage || 'Denied by user' }
          : { behavior: decision });
        break;
      }

      case 'abort': {
        const sessionId = message.sessionId || currentSessionId;
        await stopOwnedQuery(sessionId);
        emitSafe(emit, { type: 'status', status: 'idle', sessionId });
        break;
      }

      case 'new_session': {
        const previousSessionId = currentSessionId;
        if (previousSessionId) await stopOwnedQuery(previousSessionId);
        currentSessionId = null;
        emitSafe(emit, { type: 'status', status: 'idle' });
        break;
      }

      case 'rewind': {
        const targetSessionId = message.sessionId || currentSessionId;
        if (!targetSessionId) {
          emitSafe(emit, { type: 'error', message: 'No session selected' });
          break;
        }
        const messages = await loadMessages(targetSessionId);
        const targetIndex = messages.findIndex((item) => item.id === message.messageId);
        if (targetIndex < 0) {
          emitSafe(emit, { type: 'error', message: 'Message not found' });
          break;
        }
        const truncated = messages.slice(0, targetIndex + 1);
        sessionMessages.set(targetSessionId, truncated);
        emitSafe(emit, { type: 'rewind_complete', sessionId: targetSessionId, messages: truncated });
        break;
      }

      case 'plan_approval_response': {
        const pending = pendingPlanApprovals.get(message.planId);
        if (pending) {
          pendingPlanApprovals.delete(message.planId);
          pending.resolve({ approved: message.approved, feedback: message.feedback });
        }
        break;
      }

      case 'ask_user_question_response': {
        const pending = pendingUserQuestions.get(message.questionId);
        if (pending) {
          pendingUserQuestions.delete(message.questionId);
          pending.resolve({ answer: message.answer, selectedOption: message.selectedOption });
        }
        break;
      }

      case 'undo_file': {
        const targetSessionId = message.sessionId || currentSessionId;
        const absPath = workspaceFiles.safePath(message.filePath);
        if (!absPath || workspaceFiles.isProtectedWorkspacePath?.(absPath)) {
          emitSafe(emit, { type: 'undo_complete', sessionId: targetSessionId, success: false, error: 'Access denied' });
          break;
        }
        const history = targetSessionId ? fileEditHistory.get(targetSessionId) : null;
        if (!history || !history.has(absPath)) {
          emitSafe(emit, { type: 'undo_complete', sessionId: targetSessionId, success: false, error: 'No original content found' });
          break;
        }
        try {
          await fs.writeFile(absPath, history.get(absPath), 'utf-8');
          history.delete(absPath);
          emitSafe(emit, { type: 'undo_complete', sessionId: targetSessionId, success: true, filePath: message.filePath });
        } catch (error) {
          emitSafe(emit, { type: 'undo_complete', sessionId: targetSessionId, success: false, error: normalizeError(error) });
        }
        break;
      }

      default:
        break;
    }
  }

  function dispose() {
    for (const [sessionId, query] of ownedQueries) {
      try { query.close(); } catch { /* ignore */ }
      runtime.unregisterChannel({ sessionId, query });
    }
    ownedQueries.clear();
    latestRequestBySession.clear();
    pendingPermissions.clear();
    pendingPlanApprovals.clear();
    pendingUserQuestions.clear();
  }

  // A persistent SDK runtime keeps the provider environment it was created
  // with. ccgui tears down that runtime before switching providers so the next
  // turn starts with fresh credentials, model routing, and cache state.
  function resetForProviderChange() {
    dispose();
    currentSessionId = null;
    latestChatRequest += 1;
    sessionMessages.clear();
    fileEditHistory.clear();
    runtime.shutdown();
  }

  // A workspace owns its Claude project history and daemon cwd. Match ccgui's
  // session transition boundary before the runtime is pointed at another
  // directory so late events from the old project cannot enter the new chat.
  function resetForWorkspaceChange() {
    dispose();
    currentSessionId = null;
    latestChatRequest += 1;
    sessionMessages.clear();
    fileEditHistory.clear();
  }

  async function abortSession(sessionId) {
    if (!sessionId) return false;
    return await stopOwnedQuery(sessionId);
  }

  function getActiveSessionIds() {
    return [...ownedQueries.keys()];
  }

  return {
    handle,
    getContextUsage,
    dispose,
    resetForProviderChange,
    resetForWorkspaceChange,
    abortSession,
    getActiveSessionIds,
  };
}
