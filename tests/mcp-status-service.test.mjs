import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { McpStatusService } from '../desktop/runtime/mcpStatusService.js';

const stdioFixture = `
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture-server', version: '1.0.0' },
        },
      }) + '\\n');
    }
    if (request.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: [{ name: 'fixture_search', description: 'Search fixture data', inputSchema: { type: 'object' } }] },
      }) + '\\n');
    }
  }
});
`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test('MCP status service verifies STDIO and lists tools through the MCP handshake', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-mcp-status-'));
  const fixturePath = path.join(homeDir, 'stdio-fixture.mjs');

  try {
    await writeFile(fixturePath, stdioFixture, 'utf8');
    const service = new McpStatusService({ statusTimeoutMs: 2000, toolsTimeoutMs: 2000 });
    const server = { id: 'fixture', scope: 'global', config: { command: process.execPath, args: [fixturePath] } };

    const status = await service.verifyServer(server);
    assert.equal(status.id, 'fixture');
    assert.equal(status.status, 'connected');
    assert.deepEqual(status.serverInfo, { name: 'fixture-server', version: '1.0.0' });

    const tools = await service.getTools(server);
    assert.equal(tools.id, 'fixture');
    assert.equal(tools.error, null);
    assert.deepEqual(tools.tools.map(tool => tool.name), ['fixture_search']);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('MCP status service verifies Streamable HTTP and keeps disabled/invalid entries passive', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    requests.push(message.method);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: message.method === 'tools/list'
        ? { tools: [{ name: 'http_tool', description: 'HTTP fixture tool' }] }
        : { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture' } },
    }));
  });
  const address = await listen(server);

  try {
    const service = new McpStatusService({ statusTimeoutMs: 2000, toolsTimeoutMs: 2000 });
    const httpServer = {
      id: 'http-fixture',
      scope: 'project',
      config: { type: 'streamable-http', url: `http://127.0.0.1:${address.port}/mcp` },
    };
    const status = await service.verifyServer(httpServer);
    assert.equal(status.status, 'connected');
    assert.deepEqual(status.serverInfo, { name: 'http-fixture' });

    const tools = await service.getTools(httpServer);
    assert.deepEqual(tools.tools.map(tool => tool.name), ['http_tool']);
    assert.deepEqual(requests, ['initialize', 'initialize', 'notifications/initialized', 'tools/list']);

    const aggregate = await service.getStatuses({
      servers: [httpServer],
      disabled: [{ id: 'off', scope: 'global', reason: 'Server is disabled' }],
      invalid: [{ id: 'broken', scope: 'global', reason: 'Missing command/url', config: {} }],
    });
    assert.deepEqual(aggregate.map(item => [item.id, item.status]), [
      ['http-fixture', 'connected'],
      ['off', 'failed'],
      ['broken', 'failed'],
    ]);
    assert.equal(aggregate[1].error, 'Server is disabled');
    assert.match(aggregate[2].error, /Missing command\/url/);
  } finally {
    await close(server);
  }
});
