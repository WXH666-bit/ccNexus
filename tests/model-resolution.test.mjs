import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLongContextSuffix,
  modelSupportsLongContext,
  resolveModelDisplay,
  stripLongContextSuffix,
} from '../src/utils/modelResolution.js';

test('resolveModelDisplay shows provider mapped model as the primary label', () => {
  const env = {
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'Qwen3-Next-80B-A3B-Thinking',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'GLM-4.6-W8A8',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7-bf16',
  };

  assert.deepEqual(resolveModelDisplay('claude-opus-4-8', env), {
    modelId: 'claude-opus-4-8',
    label: 'Qwen3-Next-80B-A3B-Thinking',
    subtitle: 'Opus 4.8 · 最新最强大的模型',
    resolvedId: 'Qwen3-Next-80B-A3B-Thinking',
  });
  assert.equal(resolveModelDisplay('claude-sonnet-4-6', env).label, 'GLM-4.6-W8A8');
  assert.equal(resolveModelDisplay('claude-haiku-4-5', env).label, 'MiniMax-M2.7-bf16');
});

test('long context suffix follows ccgui model rules', () => {
  assert.equal(modelSupportsLongContext('claude-opus-4-8'), true);
  assert.equal(modelSupportsLongContext('claude-haiku-4-5'), false);
  assert.equal(applyLongContextSuffix('claude-opus-4-8', true), 'claude-opus-4-8[1m]');
  assert.equal(applyLongContextSuffix('claude-haiku-4-5', true), 'claude-haiku-4-5');
  assert.equal(stripLongContextSuffix('claude-opus-4-8[1m]'), 'claude-opus-4-8');
});
