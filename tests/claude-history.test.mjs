import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertClaudeHistoryEntry, readClaudeSessionMessages } from '../server/claudeHistory.js';

async function withClaudeProject(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccnexus-claude-history-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('reads Claude JSONL history as chat messages when ccnexus cache is empty', async () => {
  await withClaudeProject(async (claudeProjectDir) => {
    const sessionId = 'session-1';
    const file = path.join(claudeProjectDir, `${sessionId}.jsonl`);
    const entries = [
      {
        type: 'user',
        uuid: 'user-uuid',
        timestamp: '2026-07-27T01:00:00.000Z',
        sessionId,
        message: { role: 'user', content: '你能调用 qwen 的识图 mcp 吗' },
      },
      {
        type: 'assistant',
        uuid: 'assistant-uuid',
        timestamp: '2026-07-27T01:00:01.000Z',
        sessionId,
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'text', text: '我先检查 MCP 连接状态。' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls -la' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'tool-result-uuid',
        timestamp: '2026-07-27T01:00:02.000Z',
        sessionId,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'total 314', is_error: false },
          ],
        },
      },
    ];

    await fs.writeFile(file, entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');

    const messages = await readClaudeSessionMessages({ claudeProjectDir, sessionId });

    assert.deepEqual(messages, [
      {
        id: 'user-uuid',
        role: 'user',
        content: [{ type: 'text', text: '你能调用 qwen 的识图 mcp 吗' }],
        timestamp: Date.parse('2026-07-27T01:00:00.000Z'),
        sessionId,
      },
      {
        id: 'assistant-uuid',
        role: 'assistant',
        content: [
          { type: 'text', text: '我先检查 MCP 连接状态。' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls -la' } },
        ],
        timestamp: Date.parse('2026-07-27T01:00:01.000Z'),
        sessionId,
        model: 'claude-sonnet-4-6',
      },
      {
        id: 'tool-result-uuid',
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'total 314', is_error: false }],
        timestamp: Date.parse('2026-07-27T01:00:02.000Z'),
        sessionId,
      },
    ]);
  });
});

test('history conversion keeps assistant usage for accurate restored context percentage', () => {
  const message = convertClaudeHistoryEntry({
    type: 'assistant',
    uuid: 'assistant-with-usage',
    timestamp: '2026-07-27T01:00:07.000Z',
    message: {
      role: 'assistant',
      model: 'deepseek-v4-pro',
      usage: {
        input_tokens: 14_658,
        output_tokens: 167,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [{ type: 'text', text: 'ok' }],
    },
  }, 'session-usage');

  assert.deepEqual(message.usage, {
    input_tokens: 14_658,
    output_tokens: 167,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  });
});

test('history conversion mirrors ccgui content block normalization for thinking and command tags', () => {
  const assistant = convertClaudeHistoryEntry({
    type: 'assistant',
    uuid: 'assistant-normalized',
    timestamp: '2026-07-27T01:00:03.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'Plan from text fallback.' },
        { type: 'text', text: '<command-message>example</command-message> stays visible in assistant code examples' },
      ],
    },
  }, 'session-1');

  assert.deepEqual(assistant.content, [
    { type: 'thinking', thinking: 'Plan from text fallback.', text: 'Plan from text fallback.' },
    { type: 'text', text: '<command-message>example</command-message> stays visible in assistant code examples' },
  ]);

  const userCommand = convertClaudeHistoryEntry({
    type: 'user',
    uuid: 'user-command',
    timestamp: '2026-07-27T01:00:04.000Z',
    message: {
      role: 'user',
      content: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>src</command-args>',
    },
  }, 'session-1');

  assert.deepEqual(userCommand.content, [{ type: 'text', text: '/review src' }]);

  const hiddenMetadata = convertClaudeHistoryEntry({
    type: 'user',
    uuid: 'hidden-command-metadata',
    timestamp: '2026-07-27T01:00:05.000Z',
    message: {
      role: 'user',
      content: '<command-name>/review</command-name>\n<command-args>src</command-args>',
    },
  }, 'session-1');

  assert.equal(hiddenMetadata, null);
});

test('history conversion mirrors ccgui task notification blocks', () => {
  const message = convertClaudeHistoryEntry({
    type: 'user',
    uuid: 'task-notification',
    timestamp: '2026-07-27T01:00:06.000Z',
    message: {
      role: 'user',
      content: '<task-notification><status>completed</status><summary>Subtask finished</summary></task-notification>',
    },
  }, 'session-1');

  assert.deepEqual(message.content, [
    { type: 'task_notification', icon: '●', summary: 'Subtask finished', status: 'completed' },
  ]);
});
