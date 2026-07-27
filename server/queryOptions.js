import { buildThinkingOptions } from './thinkingOptions.js';

const VALID_PERMISSION_MODES = new Set(['default', 'plan', 'acceptEdits', 'bypassPermissions']);

function normalizePermissionMode(mode) {
  return VALID_PERMISSION_MODES.has(mode) ? mode : 'default';
}

function normalizeModel(model) {
  return typeof model === 'string' && model.trim() && model !== 'default'
    ? model.trim()
    : null;
}

export function buildClaudeQueryOptions({ cwd, env, canUseTool, clientOptions = {} }) {
  const permissionMode = normalizePermissionMode(clientOptions.mode);
  const model = normalizeModel(clientOptions.model);
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
