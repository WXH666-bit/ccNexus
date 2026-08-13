import { promises as fs } from 'node:fs';
import {
  assistantEvent,
  askUserQuestionEvent,
  modeChangedEvent,
  permissionRequestEvent,
  planApprovalEvent,
  sessionEvent,
  streamEvent,
} from '../../server/protocol.js';
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

function createRuntimeProfile(options = {}) {
  const profile = {};
  for (const key of ['model', 'mode', 'reasoning', 'agent', 'streaming', 'alwaysThinking']) {
    if (Object.prototype.hasOwnProperty.call(options, key) && options[key] !== undefined) {
      profile[key] = options[key];
    }
  }
  return profile;
}

function readRuntimeLifecycle(query) {
  const metadata = query?.runtimeMetadata || query?.runtimeLifecycle || null;
  const classification = metadata?.classification || query?.runtimeClassification;
  if (classification !== 'cold' && classification !== 'warm') return null;
  const lifecycle = {
    classification,
    reason: metadata?.runtimeRetirementReason || query?.runtimeRetirementReason || null,
  };
  if (metadata && metadata.generationId !== undefined) lifecycle.generationId = metadata.generationId;
  if (metadata && metadata.creationReason) lifecycle.creationReason = metadata.creationReason;
  return lifecycle;
}

export function createDesktopChatController({ runtime, sessions, localConfig, workspaceFiles }) {
  let currentSessionId = null;
  let latestChatRequest = 0;
  const ownedQueries = new Map();
  const latestRequestBySession = new Map();
  const pendingPermissions = new Map();
  const pendingPlanApprovals = new Map();
  const pendingUserQuestions = new Map();
  const questionQueue = [];
  const questionParents = new Set();
  let activeQuestionRequest = null;
  const sessionMessages = new Map();
  const fileEditHistory = new Map();
  const runtimeProfiles = new Map();

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
    cancelPlanApprovals(sessionId);
    cancelQuestionParents(sessionId);
    try { await query.interrupt(); } catch { /* ignore */ }
    try { query.close(); } catch { /* ignore */ }
    unregisterActiveQuery(sessionId, query);
    if (currentSessionId === sessionId) currentSessionId = null;
    return true;
  }

  function forgetSessionState(sessionId) {
    sessionMessages.delete(sessionId);
    fileEditHistory.delete(sessionId);
    runtimeProfiles.delete(sessionId);
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
      askQuestion: (input, options) => requestUserQuestionFromRenderer(
        emit,
        input,
        options,
        getSessionId?.(),
      ),
    });
    return policy.canUseTool;
  }

  function requestPlanApprovalFromRenderer(emit, request, sessionId) {
    const requestId = request?.requestId || createPendingId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingPlanApprovals.get(requestId);
        if (!pending) return;
        pendingPlanApprovals.delete(requestId);
        resolve({ approved: false, feedback: 'Plan approval timed out' });
      }, 300000);
      timer.unref?.();
      pendingPlanApprovals.set(requestId, { resolve, timer, sessionId });
      emitSafe(emit, planApprovalEvent(sessionId, {
        requestId,
        toolName: request?.toolName || 'ExitPlanMode',
        plan: typeof request?.plan === 'string' ? request.plan : '',
        allowedPrompts: Array.isArray(request?.allowedPrompts) ? request.allowedPrompts : [],
      }));
    });
  }

  function resolvePlanApproval(requestId, decision) {
    const pending = pendingPlanApprovals.get(requestId);
    if (!pending) return;
    pendingPlanApprovals.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(decision);
  }

  function cancelPlanApprovals(sessionId, feedback = 'Request aborted') {
    for (const [requestId, pending] of pendingPlanApprovals.entries()) {
      if (sessionId && pending.sessionId !== sessionId) continue;
      pendingPlanApprovals.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve({ approved: false, feedback });
    }
  }

  function normalizeQuestionItems(input) {
    if (!Array.isArray(input?.questions)) return [];
    return input.questions
      .map((item) => {
        if (!item || typeof item.question !== 'string' || !item.question.trim()) return null;
        const options = Array.isArray(item.options)
          ? item.options.map(option => (
            typeof option === 'string' ? option : option?.label
          )).filter(option => typeof option === 'string' && option.trim()).slice(0, 4)
          : [];
        return {
          question: item.question.trim().slice(0, 4000),
          options,
          context: typeof item.header === 'string' ? item.header.trim().slice(0, 80) : undefined,
        };
      })
      .filter(Boolean)
      .slice(0, 4);
  }

  function finishQuestionParent(parent, result) {
    if (!parent || parent.settled) return;
    parent.settled = true;
    questionParents.delete(parent);

    for (const [requestId, pending] of pendingUserQuestions.entries()) {
      if (pending.parent !== parent) continue;
      pendingUserQuestions.delete(requestId);
      clearTimeout(pending.timer);
    }
    for (let index = questionQueue.length - 1; index >= 0; index -= 1) {
      if (questionQueue[index].parent === parent) questionQueue.splice(index, 1);
    }
    if (activeQuestionRequest?.parent === parent) activeQuestionRequest = null;
    parent.resolve(result);
    pumpQuestionQueue();
  }

  function pumpQuestionQueue() {
    if (activeQuestionRequest || questionQueue.length === 0) return;
    const next = questionQueue.shift();
    activeQuestionRequest = next;
    const requestId = createPendingId();
    const timer = setTimeout(() => {
      finishQuestionParent(next.parent, {
        answers: next.parent.answers,
        cancelled: true,
        message: 'Question timed out',
      });
    }, 300000);
    timer.unref?.();
    pendingUserQuestions.set(requestId, {
      parent: next.parent,
      question: next.question,
      timer,
      sessionId: next.sessionId,
    });
    emitSafe(next.emit, askUserQuestionEvent(next.sessionId, {
      questionId: requestId,
      question: next.question.question,
      options: next.question.options,
      context: next.question.context,
    }));
  }

  function requestUserQuestionFromRenderer(emit, input, options, sessionId) {
    const questions = normalizeQuestionItems(input);
    if (questions.length === 0) {
      return Promise.resolve({ cancelled: true, message: 'No valid question was provided' });
    }

    return new Promise((resolve) => {
      const parent = {
        resolve,
        answers: {},
        remaining: questions.length,
        settled: false,
        sessionId,
      };
      questionParents.add(parent);
      for (const question of questions) {
        questionQueue.push({ emit, options, parent, question, sessionId });
      }
      pumpQuestionQueue();
    });
  }

  function resolveUserQuestion(questionId, response = {}) {
    const pending = pendingUserQuestions.get(questionId);
    if (!pending) return;
    pendingUserQuestions.delete(questionId);
    clearTimeout(pending.timer);
    const answer = typeof response.answer === 'string'
      ? response.answer.trim()
      : typeof response.selectedOption === 'string'
        ? response.selectedOption.trim()
        : '';
    if (!answer) {
      finishQuestionParent(pending.parent, {
        answers: pending.parent.answers,
        cancelled: true,
        message: 'Question was not answered',
      });
      return;
    }

    pending.parent.answers[pending.question.question] = answer;
    pending.parent.remaining -= 1;
    activeQuestionRequest = null;
    if (pending.parent.remaining <= 0) {
      finishQuestionParent(pending.parent, { answers: pending.parent.answers });
      return;
    }
    pumpQuestionQueue();
  }

  function cancelQuestionParents(sessionId, message = 'Request aborted') {
    for (const parent of [...questionParents]) {
      if (sessionId && parent.sessionId !== sessionId) continue;
      finishQuestionParent(parent, {
        answers: parent.answers,
        cancelled: true,
        message,
      });
    }
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
    const absPath = filePath && (typeof workspaceFiles.resolveSafePath === 'function'
      ? await workspaceFiles.resolveSafePath(filePath)
      : workspaceFiles.safePath(filePath));
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
    const { currentEnv, providerMode } = await localConfig.getProviders();
    const queryEnv = { ...process.env, ...(currentEnv || {}) };
    const effectiveClientOptions = await buildClaudeClientOptions({
      cwd: workspaceFiles.getWorkspace().cwd,
      clientOptions,
      loadAgent: (name) => localConfig.getAgent(name, workspaceFiles.getWorkspace().cwd),
    });
    const rawModelId = typeof clientOptions?.model === 'string' ? clientOptions.model : 'default';
    const runtimeProfile = createRuntimeProfile({ ...clientOptions, model: rawModelId });
    if (querySessionId) runtimeProfiles.set(querySessionId, runtimeProfile);
    const modelForUsage = rawModelId && rawModelId !== 'default'
      ? rawModelId
      : 'claude-sonnet-4-6';
    const queryOpts = buildClaudeQueryOptions({
      cwd: workspaceFiles.getWorkspace().cwd,
      env: queryEnv,
      providerMode,
      canUseTool,
      clientOptions: effectiveClientOptions,
    });
    if (querySessionId) queryOpts.resume = querySessionId;

    emitSafe(emit, { type: 'status', status: 'thinking', sessionId: querySessionId });

    let query;
    let runtimeLifecycle = null;
    let runtimeLifecycleReported = false;
    const reportRuntimeLifecycle = (sessionId) => {
      if (runtimeLifecycleReported || !runtimeLifecycle || !sessionId) return;
      runtimeLifecycleReported = true;
      const lifecycleEvent = {
        type: 'runtime_lifecycle',
        classification: runtimeLifecycle.classification,
        sessionId,
      };
      if (runtimeLifecycle.generationId !== undefined) {
        lifecycleEvent.generationId = runtimeLifecycle.generationId;
      }
      if (runtimeLifecycle.creationReason) lifecycleEvent.creationReason = runtimeLifecycle.creationReason;
      if (runtimeLifecycle.reason) lifecycleEvent.reason = runtimeLifecycle.reason;
      emitSafe(emit, lifecycleEvent);
    };
    try {
      query = await runtime.queryClaude({
        sessionId: querySessionId || `pending-${requestOrder}`,
        title: promptTitle(prompt),
        prompt,
        options: queryOpts,
        rawModelId,
        onPermissionRequest: (request) => canUseTool(request.toolName, request.input, request.options),
        onPlanApproval: (request) => requestPlanApprovalFromRenderer(emit, request, querySessionId),
      });
      runtimeLifecycle = readRuntimeLifecycle(query);

      const assistantTurn = createAssistantTurn();
      let lastAssistantId = null;
      let lastAssistantApiId = null;

      queryEvents: for await (const event of query) {
        const observedLifecycle = readRuntimeLifecycle(query);
        if (observedLifecycle && !runtimeLifecycleReported) runtimeLifecycle = observedLifecycle;
        if (!runtimeLifecycle) runtimeLifecycle = observedLifecycle;
        reportRuntimeLifecycle(event.session_id || querySessionId);
        const usage = extractUsageFromSdkEvent(event);
        if (usage) {
          assistantTurn.addUsage(usage);
          emitSafe(emit, createUsageUpdate({
            usage,
            provider: 'claude',
            model: modelForUsage,
            sessionId: event.session_id || querySessionId,
            runtimeClassification: runtimeLifecycle?.classification,
            runtimeRetirementReason: runtimeLifecycle?.reason || undefined,
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
              runtimeProfiles.set(querySessionId, runtimeProfile);
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
              reportRuntimeLifecycle(querySessionId);
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
            if (typeof event.message?.id === 'string' && event.message.id.trim()) {
              lastAssistantApiId = event.message.id.trim();
            }
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
            reportRuntimeLifecycle(finalSessionId);
            const finalAssistant = event.is_error ? null : assistantTurn.complete({
              id: lastAssistantId || `msg-${Date.now()}`,
              sessionId: finalSessionId,
            });
            if (finalAssistant) {
              if (runtimeLifecycle) {
                finalAssistant.runtimeClassification = runtimeLifecycle.classification;
                if (runtimeLifecycle.reason) {
                  finalAssistant.runtimeRetirementReason = runtimeLifecycle.reason;
                }
                if (runtimeLifecycle.generationId !== undefined) {
                  finalAssistant.runtimeGenerationId = runtimeLifecycle.generationId;
                }
                if (runtimeLifecycle.creationReason) {
                  finalAssistant.runtimeCreationReason = runtimeLifecycle.creationReason;
                }
              }
              await recordAssistantMessage(finalSessionId, finalAssistant);
              for (const block of finalAssistant.content) {
                await rememberEditableFile(finalSessionId, block);
              }
              emitSafe(emit, assistantEvent(finalAssistant));
              if (runtimeLifecycle && finalSessionId && typeof sessions.recordRuntimeLifecycle === 'function') {
                const lifecycleRecord = {
                  sessionId: finalSessionId,
                  messageId: lastAssistantApiId || finalAssistant.id,
                  timestamp: Date.now(),
                  cwd: workspaceFiles.getWorkspace().cwd,
                  model: modelForUsage,
                  usage: finalAssistant.usage,
                  classification: runtimeLifecycle.classification,
                  reason: runtimeLifecycle.reason || undefined,
                  ...(runtimeLifecycle.generationId !== undefined
                    ? { generationId: runtimeLifecycle.generationId }
                    : {}),
                  ...(runtimeLifecycle.creationReason
                    ? { creationReason: runtimeLifecycle.creationReason }
                    : {}),
                };
                try {
                  Promise.resolve(sessions.recordRuntimeLifecycle(lifecycleRecord)).catch((error) => {
                    console.error('[desktop-chat] runtime lifecycle persistence failed:', error.message);
                  });
                } catch (error) {
                  console.error('[desktop-chat] runtime lifecycle persistence failed:', error.message);
                }
              }
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

          case 'mode_changed':
            emitSafe(emit, modeChangedEvent(
              event.sessionId || querySessionId,
              event.mode,
              event.source,
            ));
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

  async function getContextUsage({
    sessionId = null,
    model,
    mode,
    reasoning,
    agent,
    streaming,
    alwaysThinking,
  } = {}) {
    const workspace = workspaceFiles.getWorkspace();
    const { currentEnv, providerMode } = await localConfig.getProviders();
    const queryEnv = { ...process.env, ...(currentEnv || {}) };
    const storedProfile = sessionId ? runtimeProfiles.get(sessionId) || {} : {};
    const requestedProfile = createRuntimeProfile({
      model,
      mode,
      reasoning,
      agent,
      streaming,
      alwaysThinking,
    });
    const profile = { ...storedProfile, ...requestedProfile };
    const rawModelId = typeof profile.model === 'string' && profile.model.trim()
      ? profile.model
      : 'default';
    if (sessionId && Object.keys(requestedProfile).length > 0) {
      runtimeProfiles.set(sessionId, { ...profile, model: rawModelId });
    }
    const clientOptions = await buildClaudeClientOptions({
      cwd: workspace.cwd,
      clientOptions: { ...profile, model: rawModelId },
      loadAgent: (name) => localConfig.getAgent(name, workspace.cwd),
    });
    const queryOptions = buildClaudeQueryOptions({
      cwd: workspace.cwd,
      env: queryEnv,
      providerMode,
      clientOptions,
    });
    if (sessionId) queryOptions.resume = sessionId;
    return runtime.getContextUsage({
      sessionId,
      title: 'Context usage',
      options: queryOptions,
      rawModelId,
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
        emitSafe(emit, { type: 'status', status: 'idle', reason: 'abort-complete', sessionId });
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
        resolvePlanApproval(message.requestId, {
          approved: message.approved === true,
          targetMode: message.targetMode,
          feedback: message.feedback,
        });
        break;
      }

      case 'set_permission_mode': {
        const sessionId = message.sessionId || currentSessionId;
        let result;
        try {
          result = typeof runtime.setPermissionMode === 'function'
            ? await runtime.setPermissionMode({ sessionId, mode: message.mode })
            : { mode: message.mode, applied: false, requiresRestart: message.mode === 'bypassPermissions' };
        } catch (error) {
          emitSafe(emit, { type: 'error', sessionId, message: normalizeError(error) });
          break;
        }
        emitSafe(emit, modeChangedEvent(
          sessionId,
          result.mode,
          result.requiresRestart ? 'manual_requires_restart' : 'manual',
        ));
        break;
      }

      case 'ask_user_question_response': {
        resolveUserQuestion(message.questionId, {
          answer: message.answer,
          selectedOption: message.selectedOption,
        });
        break;
      }

      case 'undo_file': {
        const targetSessionId = message.sessionId || currentSessionId;
        const absPath = typeof workspaceFiles.resolveSafePath === 'function'
          ? await workspaceFiles.resolveSafePath(message.filePath)
          : workspaceFiles.safePath(message.filePath);
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
    cancelPlanApprovals();
    cancelQuestionParents();
  }

  // A persistent SDK runtime keeps the provider environment it was created
  // with. ccgui tears down that runtime before switching providers so the next
  // turn starts with fresh credentials, model routing, and cache state.
  async function resetForProviderChange() {
    dispose();
    currentSessionId = null;
    latestChatRequest += 1;
    sessionMessages.clear();
    fileEditHistory.clear();
    runtimeProfiles.clear();
    await runtime.shutdown();
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
    runtimeProfiles.clear();
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
