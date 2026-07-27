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
  assert.deepEqual(options.thinking, { type: 'adaptive', display: 'summarized' });
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
    },
  });

  assert.equal(options.permissionMode, 'default');
  assert.equal('model' in options, false);
  assert.equal(options.includePartialMessages, false);
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.equal(options.effort, 'high');
});
