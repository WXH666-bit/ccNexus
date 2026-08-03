import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DesktopSessionService } from '../desktop/runtime/sessionService.js';
import { claudeProjectSessionsDir } from '../server/claudeProjectPaths.js';

test('desktop subagent history reads the current workspace sidechain without writing Claude config', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-subagent-'));
  const homeDir = path.join(tempRoot, 'home');
  const cwd = path.join(tempRoot, 'workspace');
  const sessionId = 'session-123';
  const agentId = 'agent-abc_1';
  const subagentsDir = path.join(
    claudeProjectSessionsDir({ homeDir, cwd }),
    sessionId,
    'subagents',
  );

  try {
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(path.join(subagentsDir, `agent-${agentId}.jsonl`), [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'inspect' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/index.ts' } }] } }),
    ].join('\n'), 'utf8');

    const service = new DesktopSessionService({ homeDir, cwd });
    const result = await service.loadSubagentHistory({ sessionId, agentId, toolUseId: 'tool-1' });

    assert.equal(result.success, true);
    assert.equal(result.agentId, agentId);
    assert.equal(result.toolUseId, 'tool-1');
    assert.equal(result.messages.length, 2);

    const invalid = await service.loadSubagentHistory({ sessionId: '../escape', agentId });
    assert.equal(invalid.success, false);
    assert.equal(invalid.error, 'Invalid session id');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
