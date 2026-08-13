import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRuntimeSignature,
  createRuntimeDescriptor,
  hasSameContextModel,
} from '../server/runtimeIdentity.js';

test('retains raw 1M intent after SDK model mapping', () => {
  const descriptor = createRuntimeDescriptor({
    rawModelId: '  claude-sonnet-4-6[1M]  ',
    options: {
      model: 'sonnet',
      env: { ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]' },
    },
    runtimeSessionEpoch: 'epoch-1',
    workspaceIdentity: 'D:/repo',
  });

  assert.deepEqual(descriptor, {
    rawModelId: 'claude-sonnet-4-6[1M]',
    sdkModelName: 'sonnet',
    resolvedModelId: 'deepseek-v4-pro[1m]',
    contextWindow1M: true,
    runtimeSessionEpoch: 'epoch-1',
    workspaceIdentity: 'D:/repo',
    providerGeneration: '',
  });
});

test('canonical MCP key order does not change runtime identity or expose secrets', () => {
  const descriptor = createRuntimeDescriptor({
    rawModelId: 'claude-sonnet-4-6',
    options: { model: 'sonnet' },
    runtimeSessionEpoch: 'epoch-1',
  });
  const left = buildRuntimeSignature({
    cwd: 'D:/repo',
    mcpServers: {
      docs: { command: 'node', env: { B: '2', A: '1', TOKEN: 'docs-server-secret' } },
    },
  }, descriptor);
  const right = buildRuntimeSignature({
    cwd: 'D:/repo',
    mcpServers: {
      docs: { env: { TOKEN: 'docs-server-secret', A: '1', B: '2' }, command: 'node' },
    },
  }, descriptor);

  assert.equal(left, right);
  assert.doesNotMatch(left, /docs-server-secret/);
});

test('context model comparison includes route, 1M, and epoch', () => {
  const base = createRuntimeDescriptor({
    rawModelId: 'claude-sonnet-4-6',
    options: { model: 'sonnet', env: { ANTHROPIC_MODEL: 'backend-a' } },
    runtimeSessionEpoch: 'epoch-1',
  });

  assert.equal(hasSameContextModel(base, { ...base }), true);
  assert.equal(hasSameContextModel(base, { ...base, contextWindow1M: true }), false);
  assert.equal(hasSameContextModel(base, { ...base, resolvedModelId: 'backend-b' }), false);
  assert.equal(hasSameContextModel(base, { ...base, runtimeSessionEpoch: 'epoch-2' }), false);
});

test('runtime signature keeps 1M and standard context runtimes distinct', () => {
  const standard = createRuntimeDescriptor({
    rawModelId: 'claude-sonnet-4-6',
    options: { model: 'sonnet' },
  });
  const oneMillion = createRuntimeDescriptor({
    rawModelId: 'claude-sonnet-4-6[1m]',
    options: { model: 'sonnet' },
  });

  const standardSignature = buildRuntimeSignature({ cwd: 'D:/repo' }, standard);
  const oneMillionSignature = buildRuntimeSignature({ cwd: 'D:/repo' }, oneMillion);

  assert.notEqual(standardSignature, oneMillionSignature);
  assert.match(oneMillionSignature, /"contextWindow1M":true/);
});
