import { buildThinkingOptions } from './thinkingOptions.js';
import { resolveBackendModel } from '../src/utils/modelResolution.js';
import { buildClaudeSystemPromptAppend } from './systemPrompt.js';

const VALID_PERMISSION_MODES = new Set(['default', 'plan', 'acceptEdits', 'bypassPermissions']);
const CLI_ENV_OVERRIDE_KEYS = new Set([
  'CLAUDE_CODE_EFFORT_LEVEL',
  'MAX_THINKING_TOKENS',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_AGENT_SDK_VERSION',
]);
const CLOUD_PROVIDER_FLAGS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];

function normalizePermissionMode(mode) {
  return VALID_PERMISSION_MODES.has(mode) ? mode : 'default';
}

function normalizeModel(model, env) {
  const normalized = typeof model === 'string'
    ? model.trim()
    : '';

  return normalized && normalized !== 'default'
    ? resolveBackendModel(normalized, env)
    : null;
}

function isEnvFlagEnabled(value) {
  return value === '1' || value === 1 || value === 'true' || value === true;
}

function mapModelIdToSdkName(modelId) {
  const normalized = typeof modelId === 'string' ? modelId.toLowerCase() : '';
  if (normalized.includes('opus')) return 'opus';
  if (normalized.includes('haiku')) return 'haiku';
  return 'sonnet';
}

function modelRoutingKey(modelId) {
  const normalized = typeof modelId === 'string' ? modelId.toLowerCase() : '';
  if (normalized.includes('opus')) return 'ANTHROPIC_DEFAULT_OPUS_MODEL';
  if (normalized.includes('haiku')) return 'ANTHROPIC_DEFAULT_HAIKU_MODEL';
  return 'ANTHROPIC_DEFAULT_SONNET_MODEL';
}

function buildCliEnv(env = {}, { modelId = '', resolvedModel = '' } = {}) {
  const nextEnv = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (!CLI_ENV_OVERRIDE_KEYS.has(key.toUpperCase())) {
      nextEnv[key] = value;
    }
  }

  if (resolvedModel && modelId) {
    nextEnv.ANTHROPIC_MODEL = resolvedModel;
    nextEnv[modelRoutingKey(modelId)] = resolvedModel;
  }

  nextEnv.CLAUDE_CODE_ENTRYPOINT = 'cli';
  nextEnv.USER_TYPE = 'external';
  if (CLOUD_PROVIDER_FLAGS.some((flag) => isEnvFlagEnabled(nextEnv[flag]))) {
    delete nextEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
  } else {
    nextEnv.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1';
  }
  return nextEnv;
}

function buildAdditionalDirectories(cwd, env, requestedDirectories = []) {
  return Array.from(new Set([
    cwd,
    env?.IDEA_PROJECT_PATH,
    env?.PROJECT_PATH,
    ...(Array.isArray(requestedDirectories) ? requestedDirectories : []),
  ].filter((item) => typeof item === 'string' && item.trim())));
}

function buildWebviewControlledSettingsOverride(modelId) {
  const settingsEnv = {
    CLAUDE_CODE_EFFORT_LEVEL: '',
    MAX_THINKING_TOKENS: '',
  };
  const normalizedModel = typeof modelId === 'string' ? modelId.trim() : '';
  if (normalizedModel) {
    settingsEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT = /\[1m\]$/i.test(normalizedModel) ? '' : '1';
  }
  return { env: settingsEnv };
}

export function buildClaudeQueryOptions({ cwd, env, canUseTool, clientOptions = {} }) {
  const permissionMode = normalizePermissionMode(clientOptions.mode);
  const modelId = typeof clientOptions.model === 'string' ? clientOptions.model.trim() : '';
  const model = normalizeModel(modelId, env);
  const sdkModelName = modelId && modelId !== 'default' ? mapModelIdToSdkName(modelId) : '';
  const systemPromptAppend = typeof clientOptions.systemPromptAppend === 'string'
    ? clientOptions.systemPromptAppend
    : buildClaudeSystemPromptAppend({ agentPrompt: clientOptions.agentPrompt });
  const options = {
    cwd,
    canUseTool,
    permissionMode,
    maxTurns: 100,
    enableFileCheckpointing: true,
    includePartialMessages: clientOptions.streaming !== false,
    env: buildCliEnv(env, { modelId, resolvedModel: model }),
    settings: buildWebviewControlledSettingsOverride(modelId),
    additionalDirectories: buildAdditionalDirectories(cwd, env, clientOptions.additionalDirectories),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      ...(systemPromptAppend ? { append: systemPromptAppend } : {}),
    },
    settingSources: ['user', 'project', 'local'],
    ...buildThinkingOptions(clientOptions.reasoning, {
      thinkingEnabled: clientOptions.alwaysThinking === true,
      alwaysThinkingEnabled: clientOptions.alwaysThinking === true,
      maxThinkingTokens: clientOptions.maxThinkingTokens,
      disableThinking: clientOptions.disableThinking,
    }),
  };

  if (sdkModelName) options.model = sdkModelName;
  if (clientOptions.mcpServers && typeof clientOptions.mcpServers === 'object') {
    options.mcpServers = clientOptions.mcpServers;
  }
  if (permissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true;
  }

  return options;
}
