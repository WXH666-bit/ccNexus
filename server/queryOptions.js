import { buildThinkingOptions } from './thinkingOptions.js';
import { resolveBackendModel } from '../src/utils/modelResolution.js';

const VALID_PERMISSION_MODES = new Set(['default', 'plan', 'acceptEdits', 'bypassPermissions']);

function normalizePermissionMode(mode) {
  return VALID_PERMISSION_MODES.has(mode) ? mode : 'default';
}

function normalizeModel(model, env) {
  const normalized = typeof model === 'string'
    ? model.trim().replace(/\[1m\]$/i, '')
    : '';

  return normalized && normalized !== 'default'
    ? resolveBackendModel(normalized, env)
    : null;
}

export function buildClaudeQueryOptions({ cwd, env, canUseTool, clientOptions = {} }) {
  const permissionMode = normalizePermissionMode(clientOptions.mode);
  const model = normalizeModel(clientOptions.model, env);
  const options = {
    cwd,
    canUseTool,
    permissionMode,
    maxTurns: 100,
    enableFileCheckpointing: true,
    includePartialMessages: clientOptions.streaming !== false,
    env: { ...env },
    settingSources: ['user', 'project', 'local'],
    ...buildThinkingOptions(clientOptions.reasoning),
  };

  if (model) options.model = model;
  if (permissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true;
  }

  return options;
}
