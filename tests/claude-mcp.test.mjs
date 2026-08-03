import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadMcpServersConfigAsRecord } from '../server/claudeMcp.js';

test('loads the same enabled project MCP record shape as ccgui', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-mcp-'));
  try {
    await writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({
      mcpServers: {
        globalDocs: { command: 'node', args: ['global-docs.mjs'] },
        disabled: { command: 'node', args: ['disabled.mjs'] },
      },
      disabledMcpServers: ['disabled'],
      projects: {
        'D:/repo': {
          mcpServers: {
            projectDocs: { command: 'node', args: ['project-docs.mjs'] },
            disabled: { command: 'node', args: ['project-disabled.mjs'] },
          },
        },
      },
    }));

    const servers = await loadMcpServersConfigAsRecord('D:\\repo', { homeDir });

    assert.deepEqual(servers, {
      projectDocs: { command: 'node', args: ['project-docs.mjs'] },
      disabled: { command: 'node', args: ['project-disabled.mjs'] },
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
