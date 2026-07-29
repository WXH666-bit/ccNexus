import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

test('process management uses registered active queries instead of stale sessions map', () => {
  assert.doesNotMatch(source, /sessions\.entries\(\)/);
  assert.match(source, /const activeQueries = new Map\(\)/);
  assert.match(source, /const activeQueryStartTimes = new Map\(\)/);
  assert.match(source, /const sessionDaemons = new Map\(\)/);
  assert.match(source, /function registerActiveQuery/);
  assert.match(source, /function unregisterActiveQuery/);
  assert.match(source, /function ensureSessionDaemon/);
  assert.match(source, /function buildProcessSnapshot/);
  assert.match(source, /app\.get\('\/api\/processes'/);
  assert.match(source, /snapshotAt/);
  assert.match(source, /totals:\s*\{/);
  assert.match(source, /kind:\s*'DAEMON'/);
  assert.match(source, /kind:\s*'CHANNEL'/);
  assert.match(source, /activeRequestCount:\s*1/);
});

test('idle session daemon remains visible after the active query is unregistered', () => {
  const chatRoute = source.slice(
    source.indexOf("case 'chat':"),
    source.indexOf("case 'permission_response':"),
  );

  assert.match(chatRoute, /ensureSessionDaemon\(querySessionId/);

  const finallyBlock = chatRoute.slice(chatRoute.indexOf('finally {'));
  assert.match(finallyBlock, /unregisterActiveQuery\(querySessionId, q\)/);
  assert.doesNotMatch(finallyBlock, /removeSessionDaemon\(querySessionId\)/);
});

test('process kill endpoint only targets a process found in active query snapshot', () => {
  const killRoute = source.slice(
    source.indexOf("app.post('/api/processes/:pid/kill'"),
    source.indexOf("app.get('/api/files/scan'"),
  );

  assert.match(killRoute, /findOwnedProcess\(pid\)/);
  assert.match(killRoute, /owned\.kind === 'CHANNEL'/);
  assert.match(killRoute, /owned\.kind === 'DAEMON'/);
  assert.match(killRoute, /unregisterActiveQuery\(sessionId, query\)/);
  assert.match(killRoute, /success:\s*true/);
});

test('process restart endpoint is daemon-only and recreates the registered daemon', () => {
  const restartRoute = source.slice(
    source.indexOf("app.post('/api/processes/:pid/restart'"),
    source.indexOf("app.get('/api/files/scan'"),
  );

  assert.match(restartRoute, /owned\.kind !== 'DAEMON'/);
  assert.match(restartRoute, /removeSessionDaemon\(sessionId\)/);
  assert.match(restartRoute, /ensureSessionDaemon\(sessionId/);
  assert.match(restartRoute, /restart:\s*true/);
});
