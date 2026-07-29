import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeQueryOptions } from '../server/queryOptions.js';

test('builds ccgui-style SDK options from client dialogue controls', () => {
  const canUseTool = async () => ({ behavior: 'allow' });
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: { EXISTING: '1' },
    canUseTool,
    clientOptions: {
      mode: 'bypassPermissions',
      model: 'claude-sonnet-5',
      streaming: true,
      reasoning: 'xhigh',
      alwaysThinking: true,
    },
  });

  assert.equal(options.cwd, 'D:/repo');
  assert.equal(options.permissionMode, 'bypassPermissions');
  assert.equal(options.model, 'claude-sonnet-5');
  assert.equal(options.maxTurns, 100);
  assert.equal(options.enableFileCheckpointing, true);
  assert.equal(options.includePartialMessages, true);
  assert.equal(options.allowDangerouslySkipPermissions, true);
  assert.deepEqual(options.settingSources, ['user', 'project', 'local']);
  assert.equal(Object.hasOwn(options, 'thinking'), false);
  assert.equal(Object.hasOwn(options, 'maxThinkingTokens'), false);
  assert.equal(options.effort, 'xhigh');
  assert.equal(options.env.EXISTING, '1');
  assert.equal(options.canUseTool, canUseTool);
});

test('omits default model and disables partial messages when streaming is false', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      mode: 'default',
      model: 'default',
      streaming: false,
      reasoning: 'not-real',
      alwaysThinking: true,
    },
  });

  assert.equal(options.permissionMode, 'default');
  assert.equal('model' in options, false);
  assert.equal(options.includePartialMessages, false);
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.equal(options.effort, undefined);
  assert.equal(options.maxThinkingTokens, 10000);
});

test('does not send reasoning effort when the thinking toggle is off', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6[1m]',
      reasoning: 'high',
      alwaysThinking: false,
    },
  });

  assert.equal(Object.hasOwn(options, 'effort'), false);
  assert.equal(Object.hasOwn(options, 'maxThinkingTokens'), false);
});

test('preserves ccgui long context marker before passing model to SDK', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-opus-4-8[1m]',
    },
  });

  assert.equal(options.model, 'claude-opus-4-8[1m]');
});

test('resolves ccgui provider model mapping before passing model to SDK', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'GLM-4.6-W8A8',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'Qwen3-Next-80B-A3B-Thinking',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7-bf16',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6[1m]',
    },
  });

  assert.equal(options.model, 'GLM-4.6-W8A8[1m]');
});

test('strips stale provider mapping suffix when the 1M toggle is off', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1M]',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6',
    },
  });

  assert.equal(options.model, 'deepseek-v4-pro');
});

test('role-specific provider mapping beats the default fallback model', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1M]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-haiku-4-5',
    },
  });

  assert.equal(options.model, 'deepseek-v4-flash');
});
