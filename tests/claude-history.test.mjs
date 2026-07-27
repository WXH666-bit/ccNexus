import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readClaudeSessionMessages } from '../server/claudeHistory.js';

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
