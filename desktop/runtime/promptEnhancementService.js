import { buildPromptEnhancementQueryOptions } from '../../server/queryOptions.js';
import { extractUsageFromSdkEvent } from '../../src/utils/contextUsage.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const QUERY_TITLE = 'Prompt enhancement';

function normalizeNonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringifyLocalResult(localResult) {
  try {
    return JSON.stringify(localResult, null, 2);
  } catch {
    return String(localResult);
  }
}

function buildPromptEnhancementInput({ text, localResult }) {
  return [
    'Rewrite the ORIGINAL_DRAFT into a clearer prompt while preserving intent.',
    'Use the LOCAL_RESULT only as supporting context.',
    'Return only the rewritten prompt text.',
    '',
    'ORIGINAL_DRAFT',
    '<<<PROMPT_DRAFT',
    text,
    'PROMPT_DRAFT',
    '',
    'LOCAL_RESULT',
    '<<<LOCAL_RESULT',
    stringifyLocalResult(localResult),
    'LOCAL_RESULT',
  ].join('\n');
}

function createCancelledError() {
  return new Error('Prompt enhancement was cancelled');
}

export function extractPromptEnhancementText(events) {
  if (!Array.isArray(events)) return '';
  const allParts = [];

  for (const event of events) {
    if (event?.type !== 'assistant') continue;
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of content) {
      if (block?.type !== 'text') continue;
      const text = typeof block.text === 'string' ? block.text.trim() : '';
      if (text) allParts.push(text);
    }
  }

  return allParts.join('\n\n');
}

export function createPromptEnhancementService({
  query,
  localConfig,
  workspaceFiles,
  usageStore,
} = {}) {
  if (typeof query !== 'function') throw new Error('Prompt enhancement query function is required');
  if (!localConfig || typeof localConfig.getProviders !== 'function') {
    throw new Error('Prompt enhancement localConfig.getProviders is required');
  }
  if (!workspaceFiles || typeof workspaceFiles.getWorkspace !== 'function') {
    throw new Error('Prompt enhancement workspaceFiles.getWorkspace is required');
  }

  const activeRequests = new Map();
  let disposing = false;

  async function closeActiveRequest(active) {
    if (!active || !active.query) return;
    if (active.closePromise) return active.closePromise;
    active.closed = true;
    active.closePromise = Promise.resolve()
      .then(() => active.query?.close?.())
      .catch(() => {});
    return active.closePromise;
  }

  async function interruptActiveRequest(active) {
    if (!active?.query) return;
    if (!active.interruptPromise) {
      active.interruptPromise = Promise.resolve()
        .then(() => active.query?.interrupt?.())
        .catch(() => {});
    }
    return active.interruptPromise;
  }

  async function cancel(requestId) {
    const active = activeRequests.get(requestId);
    if (!active) return false;
    active.cancelled = true;
    active.abortController.abort();
    await interruptActiveRequest(active);
    await closeActiveRequest(active);
    return true;
  }

  async function enhance({ requestId, text, localResult, model = DEFAULT_MODEL } = {}) {
    if (disposing) throw new Error('Prompt enhancement service is disposing');
    const normalizedRequestId = normalizeNonEmptyString(requestId);
    if (!normalizedRequestId) throw new Error('Prompt enhancement requires a requestId');
    if (text === undefined || text === null) throw new Error('Prompt enhancement requires text');
    if (localResult === undefined) throw new Error('Prompt enhancement requires a local result');

    const normalizedText = normalizeNonEmptyString(text);
    if (!normalizedText) throw new Error('Prompt enhancement requires non-empty text');

    const workspace = workspaceFiles.getWorkspace();
    const cwd = typeof workspace?.cwd === 'string' ? workspace.cwd : '';
    if (!cwd) throw new Error('Prompt enhancement requires an active workspace');

    if (activeRequests.has(normalizedRequestId)) {
      throw new Error(`Prompt enhancement requestId is already active: ${normalizedRequestId}`);
    }

    const active = {
      requestId: normalizedRequestId,
      query: null,
      cancelled: false,
      closed: false,
      closePromise: null,
      queryPromise: null,
      interruptPromise: null,
      abortController: new AbortController(),
    };
    activeRequests.set(normalizedRequestId, active);

    let latestUsage;
    const events = [];

    try {
      const { currentEnv, providerMode } = await localConfig.getProviders();
      const queryEnv = { ...process.env, ...(currentEnv || {}) };
      const options = buildPromptEnhancementQueryOptions({
        cwd,
        env: queryEnv,
        providerMode: providerMode || '',
        model,
      });

      if (active.cancelled) throw createCancelledError();

      const queryPromise = Promise.resolve().then(() => query({
        sessionId: `prompt-enhancement:${normalizedRequestId}`,
        title: QUERY_TITLE,
        prompt: buildPromptEnhancementInput({ text: normalizedText, localResult }),
        options,
        signal: active.abortController.signal,
      }));
      active.queryPromise = queryPromise;
      const runningQuery = await queryPromise;

      active.query = runningQuery;
      if (active.cancelled) {
        await interruptActiveRequest(active);
        await closeActiveRequest(active);
        throw createCancelledError();
      }

      for await (const event of runningQuery) {
        if (active.cancelled) break;
        events.push(event);
        const usage = extractUsageFromSdkEvent(event);
        if (usage) latestUsage = usage;
      }

      if (active.cancelled) throw createCancelledError();

      const enhancedText = extractPromptEnhancementText(events);
      if (!enhancedText) {
        throw new Error('Prompt enhancement returned empty text');
      }

      const result = {
        requestId: normalizedRequestId,
        text: enhancedText,
        model,
        usage: latestUsage,
      };

      if (latestUsage && usageStore && typeof usageStore.append === 'function') {
        await usageStore.append({
          id: normalizedRequestId,
          timestamp: Date.now(),
          cwd,
          model,
          usage: latestUsage,
        });
      }

      return result;
    } catch (error) {
      if (active?.cancelled) throw createCancelledError();
      throw error;
    } finally {
      await closeActiveRequest(active);
      if (activeRequests.get(normalizedRequestId) === active) {
        activeRequests.delete(normalizedRequestId);
      }
    }
  }

  async function dispose() {
    disposing = true;
    const active = [...activeRequests.values()];
    await Promise.all(active.map(async (request) => {
      request.cancelled = true;
      request.abortController.abort();
      await interruptActiveRequest(request);
      await closeActiveRequest(request);
      if (activeRequests.get(request.requestId) === request) {
        activeRequests.delete(request.requestId);
      }
    }));
  }

  return {
    enhance,
    cancel,
    dispose,
  };
}
