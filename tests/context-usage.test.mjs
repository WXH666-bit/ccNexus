import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateContextPercentage,
  createUsageUpdate,
  extractUsageFromSdkEvent,
  extractUsedTokens,
  getModelContextLimit,
} from '../src/utils/contextUsage.js';

test('getModelContextLimit mirrors ccgui model capacity rules', () => {
  assert.equal(getModelContextLimit('claude-opus-4-8'), 200_000);
  assert.equal(getModelContextLimit('claude-opus-4-8[1m]'), 1_000_000);
  assert.equal(getModelContextLimit('claude-haiku-4-5'), 200_000);
  assert.equal(getModelContextLimit('gpt-5.6-sol'), 1_050_000);
  assert.equal(getModelContextLimit('custom-model[500k]'), 500_000);
  assert.equal(getModelContextLimit('custom-model[2m]'), 2_000_000);
});

test('calculateContextPercentage recalculates when the selected model capacity changes', () => {
  assert.equal(calculateContextPercentage(250_000, 1_000_000), 25);
  assert.equal(calculateContextPercentage(250_000, 200_000), 100);
  assert.equal(calculateContextPercentage(0, 200_000), 0);
});

test('extractUsedTokens follows ccgui provider-aware usage formula', () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
  };

  assert.equal(extractUsedTokens(usage, 'claude'), 200);
  assert.equal(extractUsedTokens(usage, 'codex'), 150);
});

test('extractUsageFromSdkEvent reads complete assistant usage payloads', () => {
  assert.deepEqual(
    extractUsageFromSdkEvent({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 20,
        },
      },
    }),
    {
      input_tokens: 100,
      output_tokens: 20,
    },
  );

  assert.equal(
    extractUsageFromSdkEvent({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        usage: { output_tokens: 20 },
      },
    }),
    null,
  );
});

test('createUsageUpdate emits the websocket payload consumed by the context bar', () => {
  assert.deepEqual(createUsageUpdate({
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 25,
      cache_read_input_tokens: 25,
    },
    provider: 'claude',
    model: 'claude-opus-4-8[1m]',
  }), {
    type: 'usage_update',
    percentage: 0.02,
    totalTokens: 200,
    limit: 1_000_000,
    usedTokens: 200,
    maxTokens: 1_000_000,
  });
});
