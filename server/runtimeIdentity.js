import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function createRuntimeDescriptor({
  rawModelId = '',
  options = {},
  runtimeSessionEpoch = '',
  workspaceIdentity = '',
  providerGeneration = '',
} = {}) {
  const normalizedRawModelId = typeof rawModelId === 'string' ? rawModelId.trim() : '';
  return {
    rawModelId: normalizedRawModelId,
    sdkModelName: typeof options.model === 'string' ? options.model : '',
    resolvedModelId: typeof options.env?.ANTHROPIC_MODEL === 'string'
      ? options.env.ANTHROPIC_MODEL
      : '',
    contextWindow1M: /\[1m\]$/i.test(normalizedRawModelId),
    runtimeSessionEpoch: typeof runtimeSessionEpoch === 'string' ? runtimeSessionEpoch : '',
    workspaceIdentity: typeof workspaceIdentity === 'string' ? workspaceIdentity : '',
    providerGeneration: typeof providerGeneration === 'string' ? providerGeneration : '',
  };
}

export function buildRuntimeSignature(options = {}, descriptor = {}) {
  return JSON.stringify(canonicalize({
    cwd: options.cwd || '',
    additionalDirectories: options.additionalDirectories || [],
    systemPromptAppend: options.systemPrompt?.append || '',
    streamingEnabled: options.includePartialMessages !== false,
    runtimeSessionEpoch: descriptor.runtimeSessionEpoch || '',
    model: descriptor.sdkModelName || options.model || '',
    effort: options.effort || '',
    includePartialMessages: options.includePartialMessages !== false,
    contextWindow1M: descriptor.contextWindow1M === true,
    bypassPermissions: options.permissionMode === 'bypassPermissions',
    modelRouting: descriptor.resolvedModelId || options.env?.ANTHROPIC_MODEL || '',
    persistSession: options.persistSession !== false,
    strictMcpConfig: options.strictMcpConfig === true,
    mcpFingerprint: options.mcpServers == null ? null : fingerprint(options.mcpServers),
    isolatedDenyAllTools: options.isolatedDenyAllTools === true,
  }));
}

export function hasSameContextModel(current = {}, requested = {}) {
  return current.runtimeSessionEpoch === requested.runtimeSessionEpoch
    && current.sdkModelName === requested.sdkModelName
    && current.resolvedModelId === requested.resolvedModelId
    && current.contextWindow1M === requested.contextWindow1M;
}
