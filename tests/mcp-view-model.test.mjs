import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMcpViewModel } from '../src/utils/mcpViewModel.js';

test('MCP view model merges status, scope, and disabled filters like ccgui', () => {
  const model = buildMcpViewModel({
    servers: [
      { id: 'docs', name: 'Docs', scope: 'global', config: { command: 'node', args: ['docs.mjs'] } },
      { id: 'search', name: 'Search', scope: 'project', config: { url: 'https://example.test/mcp' } },
    ],
    disabled: [{ id: 'offline', scope: 'global', reason: 'Server is disabled' }],
    invalid: [{ id: 'broken', scope: 'project', reason: 'Missing command/url', config: {} }],
  }, [
    { id: 'docs', scope: 'global', status: 'connected' },
    { id: 'search', scope: 'project', status: 'failed', error: 'Connection refused' },
    { id: 'offline', scope: 'global', status: 'failed', error: 'Server is disabled' },
    { id: 'broken', scope: 'project', status: 'failed', error: 'Invalid config' },
  ]);

  assert.equal(model.counts.all, 4);
  assert.equal(model.counts.connected, 1);
  assert.equal(model.counts.disabled, 1);
  assert.deepEqual(model.items.map(item => item.id), ['docs', 'search', 'offline', 'broken']);
  assert.deepEqual(buildMcpViewModel(model.state, model.statuses, { scope: 'project' }).items.map(item => item.id), ['search', 'broken']);
  assert.deepEqual(buildMcpViewModel(model.state, model.statuses, { status: 'connected' }).items.map(item => item.id), ['docs']);
  assert.deepEqual(buildMcpViewModel(model.state, model.statuses, { search: 'OFFLINE' }).items.map(item => item.id), ['offline']);
});
