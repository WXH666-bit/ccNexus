import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

test('prompt enhancement usage store appends normalized jsonl records in the ccnexus home path', async () => {
  const { createPromptEnhancementUsageStore } = await import('../desktop/runtime/promptEnhancementUsageStore.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-prompt-enhancement-usage-'));
  const usageFile = path.join(homeDir, '.ccnexus', 'prompt-enhancement-usage.jsonl');

  try {
    const store = createPromptEnhancementUsageStore({ homeDir });
    const record = {
      id: 'enhance-1',
      timestamp: Date.parse('2026-08-11T10:00:00+08:00'),
      cwd: 'D:/repo/../repo',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5,
      },
      ignored: 'value',
    };

    await store.append(record);

    const raw = await readFile(usageFile, 'utf8');
    const lines = raw.trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      id: 'enhance-1',
      timestamp: Date.parse('2026-08-11T10:00:00+08:00'),
      cwd: path.resolve('D:/repo/../repo'),
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5,
      },
    });

    assert.deepEqual(await store.list(), [{
      id: 'enhance-1',
      timestamp: Date.parse('2026-08-11T10:00:00+08:00'),
      cwd: path.resolve('D:/repo/../repo'),
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5,
      },
    }]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('prompt enhancement usage store ignores malformed jsonl and invalid records when listing', async () => {
  const { createPromptEnhancementUsageStore } = await import('../desktop/runtime/promptEnhancementUsageStore.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-prompt-enhancement-list-'));
  const usageFile = path.join(homeDir, '.ccnexus', 'prompt-enhancement-usage.jsonl');

  try {
    await mkdir(path.dirname(usageFile), { recursive: true });
    await writeFile(usageFile, [
      '{"id":"broken"',
      JSON.stringify({
        id: 'missing-usage',
        timestamp: Date.parse('2026-08-11T11:00:00+08:00'),
        cwd: 'D:/repo',
        model: 'claude-sonnet-4-6',
      }),
      JSON.stringify({
        id: 'enhance-2',
        timestamp: Date.parse('2026-08-11T12:00:00+08:00'),
        cwd: 'D:/repo',
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1,
        },
      }),
    ].join('\n'), 'utf8');

    const store = createPromptEnhancementUsageStore({ homeDir });
    assert.deepEqual(await store.list(), [{
      id: 'enhance-2',
      timestamp: Date.parse('2026-08-11T12:00:00+08:00'),
      cwd: path.resolve('D:/repo'),
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1,
      },
    }]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
