import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateContextPercentage,
  createUsageUpdate,
  estimateMessagesUsedTokens,
  extractMessagesUsedTokens,
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

test('calculateContextPercentage keeps ccgui ratio precision for small 1M-context usage', () => {
  assert.equal(calculateContextPercentage(14_771, 1_000_000), 1.4771);
  assert.notEqual(calculateContextPercentage(14_771, 1_000_000), 2);
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

test('extractUsageFromSdkEvent ignores aggregate result usage during tool loops', () => {
  assert.equal(
    extractUsageFromSdkEvent({
      type: 'result',
      usage: {
        input_tokens: 75_000,
        cache_read_input_tokens: 180_000,
        output_tokens: 400,
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

test('estimateMessagesUsedTokens derives a non-zero initial context load from restored history', () => {
  const messages = [
    {
      role: 'user',
      content: [{ type: 'text', text: '请总结这个项目的结构。' }],
    },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Need inspect files and summarize.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
        { type: 'tool_result', content: 'src\nserver\ntests' },
        { type: 'text', text: '这个项目包含 React 前端和 Express 后端。' },
      ],
    },
  ];

  const estimate = estimateMessagesUsedTokens(messages);

  assert.ok(estimate > 20);
  assert.ok(estimate < 500);
  assert.equal(estimateMessagesUsedTokens([]), 0);
});

test('extractMessagesUsedTokens prefers restored Claude usage over rough text estimates', () => {
  const messages = [
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Short visible text.' }],
      usage: {
        input_tokens: 14_658,
        output_tokens: 167,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  ];

  assert.equal(extractMessagesUsedTokens(messages), 14_825);
});
