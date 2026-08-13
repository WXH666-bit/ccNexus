import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

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
    assert.ok(Math.abs(statistics.sessions[0].cost - 0.0000554625) < 1e-15);
    assert.equal(statistics.byModel[0].model, 'deepseek-v4-pro');
    assert.equal(statistics.byModel[0].sessionCount, 1);
    assert.equal(statistics.dailyUsage[0].sessions, 1);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage pricing follows each recorded DeepSeek model, including 1M suffixes', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-model-pricing-'));
  const workspace = path.join(homeDir, 'workspace');

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    const timestamp = Date.now();
    await service.saveSession({ id: 'mixed-model-session', title: 'Mixed models', updatedAt: timestamp });
    await service.appendMessage('mixed-model-session', {
      id: 'flash-message',
      role: 'assistant',
      model: 'deepseek-v4-flash[1M]',
      usage: {
        input_tokens: 1_000,
        output_tokens: 200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 400,
      },
      timestamp,
      content: [{ type: 'text', text: 'flash' }],
    });
    await service.appendMessage('mixed-model-session', {
      id: 'pro-message',
      role: 'assistant',
      model: 'deepseek-v4-pro',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
      },
      timestamp: timestamp + 1,
      content: [{ type: 'text', text: 'pro' }],
    });

    const statistics = await service.getUsageStatistics();
    assert.equal(statistics.sessions[0].cost, 0.000313215);
    assert.deepEqual(
      statistics.byModel.map(model => ({ model: model.model, totalCost: model.totalCost, sessionCount: model.sessionCount })),
      [
        { model: 'deepseek-v4-flash[1M]', totalCost: 0.00023912, sessionCount: 1 },
        { model: 'deepseek-v4-pro', totalCost: 0.000074095, sessionCount: 1 },
      ],
    );
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

test('usage statistics matches inner API lifecycle id after deduplicating repeated assistant content blocks', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/claudeProjectPaths.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-lifecycle-inner-id-'));
  const workspace = path.join(homeDir, 'workspace');
  const sessionId = 'inner-id-lifecycle-session';
  const timestamp = Date.parse('2026-08-13T01:00:00.000Z');
  const usage = {
    input_tokens: 100,
    output_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 900,
  };

  try {
    const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(workspace));
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(path.join(claudeProjectDir, `${sessionId}.jsonl`), [
      {
        type: 'assistant',
        uuid: 'outer-thinking',
        timestamp: new Date(timestamp).toISOString(),
        sessionId,
        message: {
          id: 'api-shared',
          role: 'assistant',
          model: 'deepseek-v4-pro',
          usage,
          content: [{ type: 'thinking', thinking: 'first block' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'outer-final',
        timestamp: new Date(timestamp + 1).toISOString(),
        sessionId,
        message: {
          id: 'api-shared',
          role: 'assistant',
          model: 'deepseek-v4-pro',
          usage,
          content: [{ type: 'text', text: 'second block' }],
        },
      },
    ].map(entry => JSON.stringify(entry)).join('\n'), 'utf8');

    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    await service.recordRuntimeLifecycle({
      sessionId,
      messageId: 'api-shared',
      cwd: workspace,
      timestamp,
      model: 'deepseek-v4-pro',
      usage,
      classification: 'cold',
    });

    const statistics = await service.getUsageStatistics();
    assert.deepEqual(statistics.runtimeLifecycle, {
      coldRequests: 1,
      warmRequests: 0,
    });
    assert.equal(statistics.totalUsage.totalTokens, 1010);
    assert.equal(statistics.sessions[0].usage.totalTokens, 1010);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop usage statistics reports cold and warm runtime requests without changing token totals', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/claudeProjectPaths.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-usage-runtime-lifecycle-'));
  const workspace = path.join(homeDir, 'workspace');
  const sessionId = 'runtime-lifecycle-session';
  const firstUsage = {
    input_tokens: 100,
    output_tokens: 10,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 0,
  };
  const secondUsage = {
    input_tokens: 100,
    output_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 120,
  };
  const timestamp = Date.now();

  try {
    const projectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(workspace));
    await mkdir(projectDir, { recursive: true });
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    await service.saveSession({ id: sessionId, title: 'Runtime lifecycle', updatedAt: timestamp });
    const claudeHistoryFile = path.join(projectDir, `${sessionId}.jsonl`);
    await writeFile(claudeHistoryFile, [
      {
        type: 'assistant',
        uuid: 'cold-outer',
        timestamp: new Date(timestamp).toISOString(),
        sessionId,
        message: { id: 'cold-message', role: 'assistant', model: 'claude-sonnet-4-6', usage: firstUsage, content: [{ type: 'text', text: 'cold' }] },
      },
      {
        type: 'assistant',
        uuid: 'warm-outer',
        timestamp: new Date(timestamp + 1).toISOString(),
        sessionId,
        message: { id: 'warm-message', role: 'assistant', model: 'claude-sonnet-4-6', usage: secondUsage, content: [{ type: 'text', text: 'warm' }] },
      },
    ].map(entry => JSON.stringify(entry)).join('\n'), 'utf8');

    const claudeHistoryBeforeLifecycle = await readFile(claudeHistoryFile, 'utf8');

    await service.recordRuntimeLifecycle({
      sessionId,
      cwd: workspace,
      timestamp,
      model: 'claude-sonnet-4-6',
      usage: firstUsage,
      classification: 'cold',
      reason: 'idle',
    });
    await service.recordRuntimeLifecycle({
      sessionId,
      cwd: workspace,
      timestamp: timestamp + 1,
      model: 'claude-sonnet-4-6',
      usage: secondUsage,
      classification: 'warm',
    });

    assert.equal(await readFile(claudeHistoryFile, 'utf8'), claudeHistoryBeforeLifecycle);
    await service.readRuntimeLifecycle();
    assert.equal(await readFile(claudeHistoryFile, 'utf8'), claudeHistoryBeforeLifecycle);
    const statistics = await service.getUsageStatistics();
    assert.equal(await readFile(claudeHistoryFile, 'utf8'), claudeHistoryBeforeLifecycle);
    assert.deepEqual(statistics.runtimeLifecycle, {
      coldRequests: 1,
      warmRequests: 1,
    });
    assert.equal(statistics.totalUsage.totalTokens, 360);
    assert.equal(statistics.sessions[0].usage.totalTokens, 360);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('runtime lifecycle JSONL preserves 100 concurrent records with distinct message IDs', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-concurrent-'));
  const workspace = path.join(homeDir, 'workspace');
  const timestamp = Date.now();
  const usage = {
    input_tokens: 10,
    output_tokens: 2,
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 4,
  };

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    const expectedMessageIds = Array.from({ length: 100 }, (_, index) => `concurrent-message-${index}`);
    await Promise.all(expectedMessageIds.map(messageId => service.recordRuntimeLifecycle({
      sessionId: 'concurrent-session',
      messageId,
      cwd: workspace,
      timestamp,
      model: 'claude-sonnet-4-6',
      usage,
      classification: 'warm',
    })));

    const records = await service.readRuntimeLifecycle();
    assert.equal(records.length, 100);
    assert.deepEqual(
      records.map(record => record.messageId).sort(),
      [...expectedMessageIds].sort(),
    );
    const jsonl = await readFile(path.join(homeDir, '.ccnexus', 'runtime-lifecycle.jsonl'), 'utf8');
    assert.equal(jsonl.trim().split(/\r?\n/).length, 100);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('runtime lifecycle matching uses distinct message IDs when usage and timestamps are identical', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/claudeProjectPaths.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-message-id-'));
  const workspace = path.join(homeDir, 'workspace');
  const sessionId = 'message-id-match-session';
  const timestamp = Date.now();
  const usage = {
    input_tokens: 12,
    output_tokens: 3,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 5,
  };

  try {
    const projectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(workspace));
    await mkdir(projectDir, { recursive: true });
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    await service.saveSession({ id: sessionId, title: 'Message ID matching', updatedAt: timestamp });
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), [
      {
        type: 'assistant',
        uuid: 'assistant-cold',
        timestamp: new Date(timestamp).toISOString(),
        sessionId,
        message: { id: 'api-cold', role: 'assistant', model: 'claude-sonnet-4-6', usage, content: [{ type: 'text', text: 'cold' }] },
      },
      {
        type: 'assistant',
        uuid: 'assistant-warm',
        timestamp: new Date(timestamp).toISOString(),
        sessionId,
        message: { id: 'api-warm', role: 'assistant', model: 'claude-sonnet-4-6', usage, content: [{ type: 'text', text: 'warm' }] },
      },
    ].map(entry => JSON.stringify(entry)).join('\n'), 'utf8');

    await service.recordRuntimeLifecycle({
      sessionId,
      messageId: 'assistant-cold',
      cwd: workspace,
      timestamp,
      model: 'claude-sonnet-4-6',
      usage,
      classification: 'cold',
    });
    await service.recordRuntimeLifecycle({
      sessionId,
      messageId: 'assistant-warm',
      cwd: workspace,
      timestamp,
      model: 'claude-sonnet-4-6',
      usage,
      classification: 'warm',
    });

    const statistics = await service.getUsageStatistics({ dateRange: 'all' });
    assert.deepEqual(statistics.runtimeLifecycle, {
      coldRequests: 1,
      warmRequests: 1,
    });
    assert.equal(statistics.totalUsage.totalTokens, 40);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('malformed middle lifecycle JSONL lines do not hide valid surrounding records or statistics', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/claudeProjectPaths.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-malformed-'));
  const workspace = path.join(homeDir, 'workspace');
  const sessionId = 'malformed-lifecycle-session';
  const timestamp = Date.now();
  const usage = {
    input_tokens: 8,
    output_tokens: 2,
    cache_creation_input_tokens: 1,
    cache_read_input_tokens: 0,
  };
  const record = (messageId, classification) => ({
    sessionId,
    messageId,
    cwd: workspace,
    timestamp,
    model: 'claude-sonnet-4-6',
    usage,
    classification,
  });

  try {
    const projectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(workspace));
    await mkdir(projectDir, { recursive: true });
    await mkdir(path.join(homeDir, '.ccnexus'), { recursive: true });
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    await service.saveSession({ id: sessionId, title: 'Malformed lifecycle', updatedAt: timestamp });
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), [
      {
        type: 'assistant',
        uuid: 'malformed-cold',
        timestamp: new Date(timestamp).toISOString(),
        sessionId,
        message: { id: 'api-malformed-cold', role: 'assistant', model: 'claude-sonnet-4-6', usage, content: [{ type: 'text', text: 'cold' }] },
      },
      {
        type: 'assistant',
        uuid: 'malformed-warm',
        timestamp: new Date(timestamp).toISOString(),
        sessionId,
        message: { id: 'api-malformed-warm', role: 'assistant', model: 'claude-sonnet-4-6', usage, content: [{ type: 'text', text: 'warm' }] },
      },
    ].map(entry => JSON.stringify(entry)).join('\n'), 'utf8');
    await writeFile(path.join(homeDir, '.ccnexus', 'runtime-lifecycle.jsonl'), [
      JSON.stringify(record('malformed-cold', 'cold')),
      '{not valid json',
      JSON.stringify(record('malformed-warm', 'warm')),
    ].join('\n') + '\n', 'utf8');

    const lifecycleRecords = await service.readRuntimeLifecycle();
    assert.deepEqual(lifecycleRecords.map(item => item.messageId), ['malformed-cold', 'malformed-warm']);
    const statistics = await service.getUsageStatistics({ dateRange: 'all' });
    assert.deepEqual(statistics.runtimeLifecycle, {
      coldRequests: 1,
      warmRequests: 1,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('first JSONL lifecycle write migrates a legacy array once before appending', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-migration-'));
  const workspace = path.join(homeDir, 'workspace');
  const timestamp = Date.now();
  const legacyRecord = {
    sessionId: 'legacy-session',
    cwd: workspace,
    timestamp,
    model: 'claude-sonnet-4-6',
    usage: {
      input_tokens: 5,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    classification: 'cold',
  };
  const newRecord = {
    sessionId: 'new-session',
    messageId: 'new-message',
    cwd: workspace,
    timestamp: timestamp + 1,
    model: 'claude-sonnet-4-6',
    usage: {
      input_tokens: 6,
      output_tokens: 2,
      cache_creation_input_tokens: 1,
      cache_read_input_tokens: 0,
    },
    classification: 'warm',
  };

  try {
    await mkdir(path.join(homeDir, '.ccnexus'), { recursive: true });
    const legacyPath = path.join(homeDir, '.ccnexus', 'runtime-lifecycle.json');
    const legacyContents = JSON.stringify([legacyRecord]);
    await writeFile(legacyPath, legacyContents, 'utf8');
    const service = new DesktopSessionService({ homeDir, cwd: workspace });

    await service.recordRuntimeLifecycle(newRecord);

    const jsonlPath = path.join(homeDir, '.ccnexus', 'runtime-lifecycle.jsonl');
    const lines = (await readFile(jsonlPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].sessionId, 'legacy-session');
    assert.equal(lines[1].messageId, 'new-message');
    assert.deepEqual((await service.readRuntimeLifecycle()).map(item => item.sessionId), ['legacy-session', 'new-session']);
    assert.equal(await readFile(legacyPath, 'utf8'), legacyContents);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('a failed JSONL append does not poison a later serialized lifecycle write', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-failure-'));
  const workspace = path.join(homeDir, 'workspace');
  const usage = {
    input_tokens: 4,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const originalAppendFile = fsPromises.appendFile;
  let shouldFail = true;
  const appendFileMock = mock.method(fsPromises, 'appendFile', async (...args) => {
    if (shouldFail && String(args[0]).endsWith(path.join('.ccnexus', 'runtime-lifecycle.jsonl'))) {
      shouldFail = false;
      throw new Error('simulated lifecycle append failure');
    }
    return originalAppendFile(...args);
  });

  try {
    const service = new DesktopSessionService({ homeDir, cwd: workspace });
    const first = service.recordRuntimeLifecycle({
      sessionId: 'failed-session',
      messageId: 'failed-message',
      cwd: workspace,
      timestamp: Date.now(),
      usage,
      classification: 'cold',
    });
    const second = service.recordRuntimeLifecycle({
      sessionId: 'later-session',
      messageId: 'later-message',
      cwd: workspace,
      timestamp: Date.now() + 1,
      usage,
      classification: 'warm',
    });

    await assert.rejects(first, /simulated lifecycle append failure/);
    await assert.doesNotReject(second);
    assert.deepEqual(
      (await service.readRuntimeLifecycle()).map(item => item.messageId),
      ['later-message'],
    );
  } finally {
    appendFileMock.mock.restore();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('runtime lifecycle append separates a valid record from a truncated final JSONL fragment', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-boundary-'));
  const workspace = path.join(homeDir, 'workspace');
  const timestamp = Date.now();
  const usage = {
    input_tokens: 7,
    output_tokens: 2,
    cache_creation_input_tokens: 1,
    cache_read_input_tokens: 0,
  };
  const existingRecord = {
    sessionId: 'boundary-session',
    messageId: 'existing-message',
    cwd: workspace,
    timestamp,
    model: 'claude-sonnet-4-6',
    usage,
    classification: 'cold',
  };

  try {
    const jsonlPath = path.join(homeDir, '.ccnexus', 'runtime-lifecycle.jsonl');
    await mkdir(path.dirname(jsonlPath), { recursive: true });
    await writeFile(jsonlPath, `${JSON.stringify(existingRecord)}\n{"sessionId":"truncated-fragment"`, 'utf8');
    const service = new DesktopSessionService({ homeDir, cwd: workspace });

    await service.recordRuntimeLifecycle({
      sessionId: 'boundary-session',
      messageId: 'new-message',
      cwd: workspace,
      timestamp: timestamp + 1,
      model: 'claude-sonnet-4-6',
      usage,
      classification: 'warm',
    });

    assert.deepEqual(
      (await service.readRuntimeLifecycle()).map(record => record.messageId),
      ['existing-message', 'new-message'],
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('runtime lifecycle compacts a large JSONL sidecar to the newest 50,000 records', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-runtime-lifecycle-compaction-'));
  const workspace = path.join(homeDir, 'workspace');
  const jsonlPath = path.join(homeDir, '.ccnexus', 'runtime-lifecycle.jsonl');
  const timestamp = Date.now() - 60_000;
  const usage = {
    input_tokens: 9,
    output_tokens: 2,
    cache_creation_input_tokens: 1,
    cache_read_input_tokens: 0,
  };
  const seedCount = 55_001;

  try {
    await mkdir(path.dirname(jsonlPath), { recursive: true });
    const seededJsonl = Array.from({ length: seedCount }, (_, index) => JSON.stringify({
      sessionId: 'compaction-session',
      messageId: `seed-message-${index}`,
      cwd: workspace,
      timestamp: timestamp + index,
      model: 'claude-sonnet-4-6',
      usage,
      classification: 'warm',
    })).join('\n') + '\n';
    await writeFile(jsonlPath, seededJsonl, 'utf8');
    const service = new DesktopSessionService({ homeDir, cwd: workspace });

    await service.recordRuntimeLifecycle({
      sessionId: 'compaction-session',
      messageId: 'newest-appended-message',
      cwd: workspace,
      timestamp: timestamp + seedCount,
      model: 'claude-sonnet-4-6',
      usage,
      classification: 'cold',
    });

    const physicalLines = (await readFile(jsonlPath, 'utf8')).trim().split(/\r?\n/);
    const physicalRecords = physicalLines.map(line => JSON.parse(line));
    assert.equal(physicalRecords.length, 50_000);
    assert.equal(physicalRecords[0].messageId, 'seed-message-5002');
    assert.equal(physicalRecords.at(-1).messageId, 'newest-appended-message');
    assert.equal((await service.readRuntimeLifecycle()).length, 50_000);

    const temporaryFiles = (await fsPromises.readdir(path.dirname(jsonlPath)))
      .filter(name => name.startsWith('.runtime-lifecycle.jsonl.') && name.endsWith('.tmp'));
    assert.deepEqual(temporaryFiles, []);
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
  assert.match(source, /useState<DateRange>\('today'\)/);
  assert.match(source, /todayUsage/);
  assert.match(source, /selectedUsage\.requestCount/);
  assert.match(source, /selectedUsage\.cost/);
  assert.match(source, /usage-today-summary/);
  assert.match(source, /cacheHitRate/);
  assert.match(source, /\['today', '7d', '30d', 'all'\]/);
  assert.match(source, /selectedUsage/);
  assert.match(source, /range === 'today'/);
});

test('usage statistics keeps prompt enhancement usage out of the normal chat cache-rate calculation', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/settings/UsageStatistics.tsx'), 'utf8');

  assert.match(source, /promptEnhancementUsage/);
  assert.match(source, /conversationUsage/);
  assert.match(source, /calculateCacheHitRate\(conversationUsage\)/);
});
