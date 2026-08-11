import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('desktop usage aggregation follows ccgui message-id deduplication and model grouping', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-statistics-'));
  const workspace = path.join(homeDir, 'workspace');

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    await service.saveSession({ id: 'session-1', title: 'Usage test', updatedAt: Date.now() });

    const usage = {
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 900,
    };
    await service.appendMessage('session-1', {
      id: 'assistant-message-1',
      role: 'assistant',
      model: 'deepseek-v4-pro',
      usage,
      timestamp: Date.now(),
      content: [{ type: 'text', text: 'first block' }],
    });
    // Claude JSONL can contain another assistant line with the same message.id
    // for a separate content block; ccgui counts that usage only once.
    await service.appendMessage('session-1', {
      id: 'assistant-message-1',
      role: 'assistant',
      model: 'deepseek-v4-pro',
      usage,
      timestamp: Date.now() + 1,
      content: [{ type: 'thinking', thinking: 'second block' }],
    });

    const statistics = await service.getUsageStatistics();
    assert.equal(statistics.totalSessions, 1);
    assert.deepEqual(statistics.totalUsage, {
      inputTokens: 100,
      outputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 900,
      totalTokens: 1010,
    });
    assert.equal(statistics.sessions[0].model, 'deepseek-v4-pro');
    assert.equal(statistics.sessions[0].cost, 0.00072);
    assert.equal(statistics.byModel[0].model, 'deepseek-v4-pro');
    assert.equal(statistics.byModel[0].sessionCount, 1);
    assert.equal(statistics.dailyUsage[0].sessions, 1);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage aggregation returns an accurate local-day summary', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-today-'));
  const workspace = path.join(homeDir, 'workspace');

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTimestamp = startOfToday.getTime() + 60 * 60 * 1000;
    const yesterdayTimestamp = startOfToday.getTime() - 60 * 60 * 1000;
    const todayUsage = {
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 20,
    };
    const crossDayUsage = {
      input_tokens: 200,
      output_tokens: 20,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 30,
    };

    await service.saveSession({ id: 'today-session', title: 'Today', updatedAt: todayTimestamp });
    await service.appendMessage('today-session', {
      id: 'today-message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: todayUsage,
      timestamp: todayTimestamp,
      content: [{ type: 'text', text: 'today' }],
    });
    await service.appendMessage('today-session', {
      id: 'today-message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: todayUsage,
      timestamp: todayTimestamp + 1,
      content: [{ type: 'thinking', thinking: 'duplicate content block' }],
    });

    await service.saveSession({ id: 'cross-day-session', title: 'Cross day', updatedAt: todayTimestamp });
    await service.appendMessage('cross-day-session', {
      id: 'yesterday-message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: crossDayUsage,
      timestamp: yesterdayTimestamp,
      content: [{ type: 'text', text: 'yesterday' }],
    });
    await service.appendMessage('cross-day-session', {
      id: 'today-cross-day-message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: crossDayUsage,
      timestamp: todayTimestamp + 2,
      content: [{ type: 'text', text: 'today again' }],
    });

    const statistics = await service.getUsageStatistics({ dateRange: 'all' });
    assert.deepEqual(statistics.todayUsage, {
      inputTokens: 300,
      outputTokens: 30,
      cacheWriteTokens: 15,
      cacheReadTokens: 50,
      totalTokens: 395,
      requestCount: 2,
      sessions: 2,
      cost: 0.00142125,
    });

    const todayKey = [
      startOfToday.getFullYear(),
      String(startOfToday.getMonth() + 1).padStart(2, '0'),
      String(startOfToday.getDate()).padStart(2, '0'),
    ].join('-');
    const today = statistics.dailyUsage.find(day => day.date === todayKey);
    const yesterday = statistics.dailyUsage.find(day => day.date !== todayKey);
    assert.equal(today.requestCount, 2);
    assert.equal(today.sessions, 2);
    assert.equal(yesterday.sessions, 1);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage dateRange today includes only the local calendar day', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-range-today-'));
  const workspace = path.join(homeDir, 'workspace');

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTimestamp = startOfToday.getTime() + 60 * 60 * 1000;
    const yesterdayTimestamp = startOfToday.getTime() - 60 * 60 * 1000;

    await service.saveSession({ id: 'range-session', title: 'Range', updatedAt: todayTimestamp });
    await service.appendMessage('range-session', {
      id: 'range-today-message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 20,
      },
      timestamp: todayTimestamp,
      content: [{ type: 'text', text: 'today' }],
    });
    await service.appendMessage('range-session', {
      id: 'range-yesterday-message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 200,
        output_tokens: 20,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 30,
      },
      timestamp: yesterdayTimestamp,
      content: [{ type: 'text', text: 'yesterday' }],
    });

    const statistics = await service.getUsageStatistics({ dateRange: 'today' });
    assert.equal(statistics.dateRange, 'today');
    assert.deepEqual(statistics.totalUsage, {
      inputTokens: 100,
      outputTokens: 10,
      cacheWriteTokens: 5,
      cacheReadTokens: 20,
      totalTokens: 135,
    });
    assert.equal(statistics.totalSessions, 1);
    assert.equal(statistics.dailyUsage.length, 1);
    assert.equal(statistics.todayUsage.requestCount, 1);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage aggregation deduplicates Claude JSONL lines by inner message.id', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-jsonl-'));
  const workspace = path.join(homeDir, 'workspace');
  const { encodeClaudeProjectPath } = await import('../server/claudeProjectPaths.js');

  try {
    const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(workspace));
    await (await import('node:fs/promises')).mkdir(claudeProjectDir, { recursive: true });
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    const sessionId = 'jsonl-session';
    const usage = {
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 900,
    };
    const entries = [
      { type: 'assistant', uuid: 'outer-thinking', timestamp: '2026-07-27T01:00:00.000Z', message: { id: 'api-message', role: 'assistant', model: 'deepseek-v4-pro', usage, content: [{ type: 'thinking', thinking: 'x' }] } },
      { type: 'assistant', uuid: 'outer-text', timestamp: '2026-07-27T01:00:00.001Z', message: { id: 'api-message', role: 'assistant', model: 'deepseek-v4-pro', usage, content: [{ type: 'text', text: 'x' }] } },
    ];
    await (await import('node:fs/promises')).writeFile(
      path.join(claudeProjectDir, `${sessionId}.jsonl`),
      entries.map(entry => JSON.stringify(entry)).join('\n'),
      'utf8',
    );

    const statistics = await service.getUsageStatistics();
    assert.equal(statistics.totalSessions, 1);
    assert.equal(statistics.totalUsage.totalTokens, 1010);
    assert.equal(statistics.totalUsage.cacheReadTokens, 900);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage aggregation supports ccgui current and all-project scopes', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/claudeProjectPaths.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-scopes-'));
  const workspaceA = path.join(homeDir, 'workspace-a');
  const workspaceB = path.join(homeDir, 'workspace-b');

  try {
    const usage = {
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 900,
    };
    for (const [workspace, sessionId] of [[workspaceA, 'scope-a'], [workspaceB, 'scope-b']]) {
      const projectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(workspace));
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, `${sessionId}.jsonl`), JSON.stringify({
        type: 'assistant',
        uuid: `${sessionId}-outer`,
        timestamp: '2026-07-27T01:00:00.000Z',
        sessionId,
        message: {
          id: `${sessionId}-message`,
          role: 'assistant',
          model: 'deepseek-v4-pro',
          usage,
          content: [{ type: 'text', text: workspace }],
        },
      }), 'utf8');
    }

    const service = new DesktopSessionService({ homeDir, cwd: workspaceA });
    const current = await service.getUsageStatistics({ scope: 'current' });
    assert.equal(current.scope, 'current');
    assert.equal(current.projectPath, path.resolve(workspaceA));
    assert.equal(current.totalSessions, 1);
    assert.equal(current.totalUsage.totalTokens, 1010);

    const all = await service.getUsageStatistics({ scope: 'all' });
    assert.equal(all.scope, 'all');
    assert.equal(all.projectPath, 'all');
    assert.equal(all.projectName, 'All Projects');
    assert.equal(all.totalSessions, 2);
    assert.equal(all.totalUsage.totalTokens, 2020);
    assert.equal(all.totalUsage.cacheReadTokens, 1800);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage statistics merge prompt enhancement ledger usage without creating synthetic sessions', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-ledger-'));
  const workspaceA = path.join(homeDir, 'workspace-a');
  const workspaceB = path.join(homeDir, 'workspace-b');
  const usageFile = path.join(homeDir, '.ccnexus', 'prompt-enhancement-usage.jsonl');

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayTimestamp = startOfToday.getTime() + (2 * 60 * 60 * 1000);
  const yesterdayTimestamp = startOfToday.getTime() - (2 * 60 * 60 * 1000);

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspaceA });
    await service.saveSession({ id: 'session-a', title: 'Claude usage', updatedAt: todayTimestamp });
    await service.appendMessage('session-a', {
      id: 'assistant-a',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 20,
      },
      timestamp: todayTimestamp,
      content: [{ type: 'text', text: 'primary response' }],
    });

    await mkdir(path.dirname(usageFile), { recursive: true });
    await writeFile(usageFile, [
      JSON.stringify({
        id: 'enhance-a',
        timestamp: todayTimestamp + 1,
        cwd: workspaceA,
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 30,
          output_tokens: 7,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
        },
      }),
      '{"id":"broken"',
      JSON.stringify({
        id: 'enhance-b',
        timestamp: todayTimestamp + 2,
        cwd: workspaceB,
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 50,
          output_tokens: 9,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 4,
        },
      }),
      JSON.stringify({
        id: 'enhance-old',
        timestamp: yesterdayTimestamp,
        cwd: workspaceA,
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 999,
          output_tokens: 999,
          cache_creation_input_tokens: 999,
          cache_read_input_tokens: 999,
        },
      }),
    ].join('\n'), 'utf8');

    const currentToday = await service.getUsageStatistics({ scope: 'current', dateRange: 'today' });
    assert.equal(currentToday.totalSessions, 1);
    assert.equal(currentToday.sessions.length, 1);
    assert.equal(currentToday.sessions[0].sessionId, 'session-a');
    assert.deepEqual(currentToday.totalUsage, {
      inputTokens: 130,
      outputTokens: 17,
      cacheWriteTokens: 7,
      cacheReadTokens: 23,
      totalTokens: 177,
    });
    assert.equal(currentToday.promptEnhancementCount, 1);
    assert.deepEqual(currentToday.promptEnhancementUsage, {
      inputTokens: 30,
      outputTokens: 7,
      cacheWriteTokens: 2,
      cacheReadTokens: 3,
      totalTokens: 42,
    });
    assert.equal(currentToday.promptEnhancementCost, 0.0002034);
    assert.equal(currentToday.estimatedCost, 0.00067815);
    assert.deepEqual(currentToday.todayUsage, {
      inputTokens: 130,
      outputTokens: 17,
      cacheWriteTokens: 7,
      cacheReadTokens: 23,
      totalTokens: 177,
      requestCount: 2,
      sessions: 1,
      cost: 0.00067815,
    });
    assert.equal(currentToday.dailyUsage.length, 1);
    assert.equal(currentToday.dailyUsage[0].sessions, 1);
    assert.equal(currentToday.dailyUsage[0].requestCount, 2);
    assert.equal(currentToday.byModel.length, 1);
    assert.equal(currentToday.byModel[0].sessionCount, 1);
    assert.equal(currentToday.byModel[0].totalTokens, 177);
    assert.equal(currentToday.byModel[0].totalCost, 0.00067815);

    const allToday = await service.getUsageStatistics({ scope: 'all', dateRange: 'today' });
    assert.equal(allToday.totalSessions, 0);
    assert.equal(allToday.promptEnhancementCount, 2);
    assert.deepEqual(allToday.promptEnhancementUsage, {
      inputTokens: 80,
      outputTokens: 16,
      cacheWriteTokens: 3,
      cacheReadTokens: 7,
      totalTokens: 106,
    });
    assert.equal(allToday.promptEnhancementCost, 0.00049335);
    assert.deepEqual(allToday.totalUsage, {
      inputTokens: 80,
      outputTokens: 16,
      cacheWriteTokens: 3,
      cacheReadTokens: 7,
      totalTokens: 106,
    });
    assert.equal(allToday.estimatedCost, 0.00049335);
    assert.equal(allToday.todayUsage.requestCount, 2);
    assert.equal(allToday.todayUsage.sessions, 0);
    assert.equal(allToday.dailyUsage[0].requestCount, 2);
    assert.equal(allToday.dailyUsage[0].sessions, 0);
    assert.equal(allToday.byModel[0].sessionCount, 0);
    assert.equal(allToday.byModel[0].totalTokens, 106);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('usage statistics UI renders the backend today summary contract', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/settings/UsageStatistics.tsx'), 'utf8');
  assert.match(source, /todayUsage/);
  assert.match(source, /selectedUsage\.requestCount/);
  assert.match(source, /selectedUsage\.cost/);
  assert.match(source, /usage-today-summary/);
  assert.match(source, /cacheHitRate/);
  assert.match(source, /\['today', '7d', '30d', 'all'\]/);
  assert.match(source, /selectedUsage/);
  assert.match(source, /range === 'today'/);
});
