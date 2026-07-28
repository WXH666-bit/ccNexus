import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

test('process management uses registered active queries instead of stale sessions map', () => {
  assert.doesNotMatch(source, /sessions\.entries\(\)/);
  assert.match(source, /const activeQueries = new Map\(\)/);
  assert.match(source, /const activeQueryStartTimes = new Map\(\)/);
  assert.match(source, /function registerActiveQuery/);
  assert.match(source, /function unregisterActiveQuery/);
  assert.match(source, /app\.get\('\/api\/processes'/);
  assert.match(source, /snapshotAt/);
  assert.match(source, /totals:\s*\{/);
  assert.match(source, /kind:\s*'CHANNEL'/);
  assert.match(source, /activeRequestCount:\s*1/);
});

test('process kill endpoint only targets a process found in active query snapshot', () => {
  const killRoute = source.slice(
    source.indexOf("app.post('/api/processes/:pid/kill'"),
    source.indexOf("app.get('/api/files/scan'"),
  );

  assert.match(killRoute, /for \(const \[sessionId, query\] of activeQueries\.entries\(\)\)/);
  assert.match(killRoute, /const processRef = queryProcess\(query\)/);
  assert.match(killRoute, /processRef && processRef\.pid === pid/);
  assert.match(killRoute, /unregisterActiveQuery\(sessionId, query\)/);
  assert.match(killRoute, /success:\s*true/);
});
