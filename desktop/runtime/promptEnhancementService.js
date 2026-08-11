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
  let latestText = '';

  for (const event of events) {
    if (event?.type !== 'assistant') continue;
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    const parts = [];
    for (const block of content) {
      if (block?.type !== 'text') continue;
      const text = typeof block.text === 'string' ? block.text.trim() : '';
      if (text) parts.push(text);
    }
    if (parts.length > 0) latestText = parts.join('\n\n');
  }

  return latestText;
}

export function createPromptEnhancementService({
  query,
  localConfig,
  workspaceFiles,
  usageStore: _usageStore,
} = {}) {
  if (typeof query !== 'function') throw new Error('Prompt enhancement query function is required');
  if (!localConfig || typeof localConfig.getProviders !== 'function') {
    throw new Error('Prompt enhancement localConfig.getProviders is required');
  }
  if (!workspaceFiles || typeof workspaceFiles.getWorkspace !== 'function') {
    throw new Error('Prompt enhancement workspaceFiles.getWorkspace is required');
  }

  const activeRequests = new Map();

  async function closeActiveRequest(active) {
    if (!active || active.closed) return;
    active.closed = true;
    try { active.query?.close?.(); } catch { /* ignore */ }
  }

  async function cancel(requestId) {
    const active = activeRequests.get(requestId);
    if (!active) return false;
    active.cancelled = true;
    try { await active.query?.interrupt?.(); } catch { /* ignore */ }
    await closeActiveRequest(active);
    return true;
  }

  async function enhance({ requestId, text, localResult, model = DEFAULT_MODEL } = {}) {
    const normalizedRequestId = normalizeNonEmptyString(requestId);
    if (!normalizedRequestId) throw new Error('Prompt enhancement requires a requestId');
    if (text === undefined || text === null) throw new Error('Prompt enhancement requires text');
    if (localResult === undefined) throw new Error('Prompt enhancement requires a local result');

    const normalizedText = normalizeNonEmptyString(text);
    if (!normalizedText) throw new Error('Prompt enhancement requires non-empty text');

    const workspace = workspaceFiles.getWorkspace();
    const cwd = typeof workspace?.cwd === 'string' ? workspace.cwd : '';
    if (!cwd) throw new Error('Prompt enhancement requires an active workspace');

    const { currentEnv, providerMode } = await localConfig.getProviders();
    const queryEnv = { ...process.env, ...(currentEnv || {}) };
    const options = buildPromptEnhancementQueryOptions({
      cwd,
      env: queryEnv,
      providerMode: providerMode || '',
      model,
    });

    const active = {
      requestId: normalizedRequestId,
      query: null,
      cancelled: false,
      closed: false,
    };
    activeRequests.set(normalizedRequestId, active);

    let latestUsage;
    const events = [];

    try {
      const runningQuery = await query({
        sessionId: `prompt-enhancement:${normalizedRequestId}`,
        title: QUERY_TITLE,
        prompt: buildPromptEnhancementInput({ text: normalizedText, localResult }),
        options,
      });

      active.query = runningQuery;
      if (active.cancelled) {
        try { await active.query?.interrupt?.(); } catch { /* ignore */ }
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

      return {
        requestId: normalizedRequestId,
        text: enhancedText,
        model,
        usage: latestUsage,
      };
    } catch (error) {
      if (active?.cancelled) throw createCancelledError();
      throw error;
    } finally {
      activeRequests.delete(normalizedRequestId);
      await closeActiveRequest(active);
    }
  }

  function dispose() {
    for (const active of activeRequests.values()) {
      active.cancelled = true;
      try { active.query?.close?.(); } catch { /* ignore */ }
      active.closed = true;
    }
    activeRequests.clear();
  }

  return {
    enhance,
    cancel,
    dispose,
  };
}
