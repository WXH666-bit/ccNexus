import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClaudeSessionMessages } from '../../server/claudeHistory.js';
import { claudeProjectSessionsDir, encodeClaudeProjectPath } from '../../server/claudeProjectPaths.js';
import { createPromptEnhancementUsageStore } from './promptEnhancementUsageStore.js';

const PROJECT_INDEX_DIR = 'projects';
const PROJECT_INDEX_VERSION = 1;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SUBAGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SUBAGENT_JSONL_LINES = 50_000;
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
const USAGE_SCOPE_CURRENT = 'current';
const USAGE_SCOPE_ALL = 'all';

function sessionFile(directory, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '_index' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session id');
  }
  return path.join(directory, `${sessionId}.json`);
}

function normalizeWorkspacePath(workspacePath) {
  return path.resolve(workspacePath || process.cwd());
}

function projectIndexFile(directory, workspacePath) {
  return path.join(directory, PROJECT_INDEX_DIR, `${encodeClaudeProjectPath(workspacePath)}.json`);
}

function claudeProjectsRoot(homeDir) {
  return path.join(homeDir, '.claude', 'projects');
}

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function titleFromMessages(messages, fallbackTitle) {
  const text = messages
    .find((message) => message?.role === 'user')
    ?.content
    ?.find((block) => block?.type === 'text')
    ?.text;
  return typeof text === 'string' && text.trim()
    ? text.trim().slice(0, 60)
    : fallbackTitle;
}

function tokenValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
}

function usageFromMessage(message) {
  return usageFromRaw(message?.usage);
}

function usageFromRaw(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = tokenValue(usage.input_tokens);
  const outputTokens = tokenValue(usage.output_tokens);
  const cacheWriteTokens = tokenValue(usage.cache_creation_input_tokens);
  const cacheReadTokens = tokenValue(usage.cache_read_input_tokens);
  if (inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens === 0) return null;
  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens,
  };
}

function addUsage(target, source) {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.totalTokens += source.totalTokens;
}

function messageTimestamp(message, fallback) {
  const timestamp = typeof message?.timestamp === 'number'
    ? message.timestamp
    : Date.parse(message?.timestamp || '');
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function startOfLocalDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const DEFAULT_CLAUDE_PRICING = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
const CLAUDE_PRICING = [
  ['claude-opus-4-8', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-1', { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }],
  ['claude-opus-4', { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }],
  ['claude-fable-5', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
  ['claude-sonnet-4-6', DEFAULT_CLAUDE_PRICING],
  ['claude-sonnet-5', DEFAULT_CLAUDE_PRICING],
  ['claude-sonnet-4-5', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, tier: [6, 22.5, 7.5, 0.6] }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, tier: [6, 22.5, 7.5, 0.6] }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
  ['claude-haiku-4', { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
];

function pricingForModel(model) {
  const raw = typeof model === 'string' && model.trim() ? model.toLowerCase() : 'claude-sonnet-4-6';
  const claudeIndex = raw.indexOf('claude-');
  const normalized = claudeIndex >= 0 ? raw.slice(claudeIndex) : raw;
  return CLAUDE_PRICING.find(([prefix]) => normalized.startsWith(prefix))?.[1] || DEFAULT_CLAUDE_PRICING;
}

function usageCost(usage, model) {
  const pricing = pricingForModel(model);
  const requestTokens = usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  const rates = requestTokens > 200_000 && pricing.tier
    ? { input: pricing.tier[0], output: pricing.tier[1], cacheWrite: pricing.tier[2], cacheRead: pricing.tier[3] }
    : pricing;
  return (
    (usage.inputTokens * rates.input)
    + (usage.outputTokens * rates.output)
    + (usage.cacheWriteTokens * rates.cacheWrite)
    + (usage.cacheReadTokens * rates.cacheRead)
  ) / 1_000_000;
}

export class DesktopSessionService {
  constructor({
    homeDir = process.env.HOME || os.homedir() || '/tmp',
    cwd = process.cwd(),
    promptEnhancementUsage = null,
  } = {}) {
    this.homeDir = homeDir;
    this.cwd = normalizeWorkspacePath(cwd);
    this.sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
    this.promptEnhancementUsage = promptEnhancementUsage || createPromptEnhancementUsageStore({ homeDir });
  }

  setCwd(nextCwd) {
    this.cwd = normalizeWorkspacePath(nextCwd);
  }

  async readProjectIndex() {
    try {
      const raw = JSON.parse(await fs.readFile(projectIndexFile(this.sessionsDir, this.cwd), 'utf8'));
      if (raw?.version !== PROJECT_INDEX_VERSION || raw.projectPath !== this.cwd || !Array.isArray(raw.sessions)) {
        return [];
      }
      return raw.sessions;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async writeProjectIndex(index) {
    const filePath = projectIndexFile(this.sessionsDir, this.cwd);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      version: PROJECT_INDEX_VERSION,
      projectPath: this.cwd,
      updatedAt: Date.now(),
      sessions: index,
    }, null, 2), 'utf8');
  }

  async listSessions() {
    const index = await this.readProjectIndex();
    return [...index].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  claudeProjectDir() {
    return claudeProjectSessionsDir({ homeDir: this.homeDir, cwd: this.cwd });
  }

  async loadSubagentHistory({ sessionId, agentId, description, toolUseId } = {}) {
    const response = { success: false, sessionId, toolUseId, agentId };
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      return { ...response, error: 'Invalid session id' };
    }
    if (agentId !== undefined && (typeof agentId !== 'string' || !SUBAGENT_ID_PATTERN.test(agentId))) {
      return { ...response, error: 'Invalid agent id' };
    }

    const subagentsDir = path.join(this.claudeProjectDir(), sessionId, 'subagents');
    let jsonlFile = agentId
      ? path.join(subagentsDir, `agent-${agentId}.jsonl`)
      : null;

    if (!jsonlFile && typeof description === 'string' && description.trim()) {
      try {
        const entries = await fs.readdir(subagentsDir, { withFileTypes: true });
        const candidates = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.meta.json')) continue;
          const metaFile = path.join(subagentsDir, entry.name);
          try {
            const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
            if (meta?.description !== description) continue;
            const jsonlName = entry.name.replace(/\.meta\.json$/, '.jsonl');
            const candidate = path.join(subagentsDir, jsonlName);
            const stat = await fs.stat(candidate);
            if (stat.isFile()) candidates.push({ candidate, mtimeMs: stat.mtimeMs });
          } catch {
            // Ignore malformed metadata and races with a running subagent.
          }
        }
        candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
        jsonlFile = candidates[0]?.candidate || null;
      } catch (error) {
        if (error.code !== 'ENOENT') return { ...response, error: error.message };
      }
    }

    if (!jsonlFile) return { ...response, error: 'Subagent log not found' };

    try {
      const raw = await fs.readFile(jsonlFile, 'utf8');
      const messages = [];
      for (const line of raw.split(/\r?\n/).filter(Boolean).slice(0, MAX_SUBAGENT_JSONL_LINES)) {
        try { messages.push(JSON.parse(line)); } catch { /* skip a partial JSONL line */ }
      }
      const fileName = path.basename(jsonlFile);
      const resolvedAgentId = fileName.startsWith('agent-') && fileName.endsWith('.jsonl')
        ? fileName.slice('agent-'.length, -'.jsonl'.length)
        : agentId;
      return { success: true, sessionId, toolUseId, agentId: resolvedAgentId, messages };
    } catch (error) {
      if (error.code === 'ENOENT') return { ...response, error: 'Subagent log not found' };
      return { ...response, error: error.message || 'Unable to read subagent log' };
    }
  }

  async listClaudeProjectDirectories() {
    const projectsRoot = claudeProjectsRoot(this.homeDir);
    try {
      const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(projectsRoot, entry.name));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async listClaudeUsageSessions() {
    const sessions = [];
    for (const claudeDir of await this.listClaudeProjectDirectories()) {
      let entries;
      try {
        entries = await fs.readdir(claudeDir, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const sessionId = path.basename(entry.name, '.jsonl');
        try {
          sessionFile(this.sessionsDir, sessionId);
        } catch {
          continue;
        }

        const filePath = path.join(claudeDir, entry.name);
        let stat;
        try {
          stat = await fs.stat(filePath);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        sessions.push({
          session: {
            id: sessionId,
            title: `Session ${sessionId.slice(0, 8)}`,
            updatedAt: stat.mtimeMs,
          },
          claudeProjectDir: claudeDir,
        });
      }
    }
    return sessions;
  }

  async syncWithClaude(options = {}) {
    const projectIndex = await this.readProjectIndex();
    const claudeDir = this.claudeProjectDir();
    const claudeDirExists = await directoryExists(claudeDir);
    const protectedSessionIds = new Set(options.protectedSessionIds || []);
    const kept = [];
    const deletedSessionIds = [];

    for (const session of projectIndex) {
      if (!session?.id) continue;

      const currentClaudeFile = await fileExists(path.join(claudeDir, `${session.id}.jsonl`));
      if (!claudeDirExists) {
        kept.push(session);
        continue;
      }

      if (protectedSessionIds.has(session.id) || currentClaudeFile) {
        kept.push(session);
        continue;
      }

      try {
        const cachedMessages = JSON.parse(await fs.readFile(sessionFile(this.sessionsDir, session.id), 'utf8'));
        if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
          kept.push(session);
          continue;
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      try {
        await fs.unlink(sessionFile(this.sessionsDir, session.id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      deletedSessionIds.push(session.id);
    }

    if (!claudeDirExists) {
      kept.sort((left, right) => right.updatedAt - left.updatedAt);
      await this.writeProjectIndex(kept);
      return { sessions: kept, deletedSessionIds };
    }

    const knownIds = new Set(kept.map((session) => session.id));
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = path.basename(entry.name, '.jsonl');
      if (knownIds.has(sessionId)) continue;
      try {
        sessionFile(this.sessionsDir, sessionId);
      } catch {
        continue;
      }

      const filePath = path.join(claudeDir, entry.name);
      const stat = await fs.stat(filePath);
      const messages = await readClaudeSessionMessages({ claudeProjectDir: claudeDir, sessionId });
      const imported = {
        id: sessionId,
        title: titleFromMessages(messages, `Session ${sessionId.slice(0, 8)}`),
        updatedAt: stat.mtimeMs,
      };
      kept.push(imported);
      knownIds.add(sessionId);
    }

    kept.sort((left, right) => right.updatedAt - left.updatedAt);
    await this.writeProjectIndex(kept);
    return { sessions: kept, deletedSessionIds };
  }

  async saveSession(session) {
    if (!session?.id) throw new Error('Session id is required');
    sessionFile(this.sessionsDir, session.id);

    const index = [...await this.readProjectIndex()];
    const existingIndex = index.findIndex((entry) => entry.id === session.id);
    const existing = existingIndex >= 0 ? index[existingIndex] : undefined;
    const entry = {
      id: session.id,
      title: session.title ?? existing?.title ?? `Session ${session.id.slice(0, 8)}`,
      updatedAt: session.updatedAt ?? existing?.updatedAt ?? Date.now(),
    };
    const isFavorite = session.isFavorite ?? existing?.isFavorite;
    const favoritedAt = session.favoritedAt ?? existing?.favoritedAt;
    if (isFavorite !== undefined) entry.isFavorite = Boolean(isFavorite);
    if (favoritedAt !== undefined && Number.isFinite(favoritedAt)) entry.favoritedAt = favoritedAt;

    if (existingIndex >= 0) index.splice(existingIndex, 1);
    index.unshift(entry);
    await this.writeProjectIndex(index);
    return entry;
  }

  async getSessions(options = {}) {
    const synced = await this.syncWithClaude(options);
    return { type: 'session_list', sessions: synced.sessions, deletedSessionIds: synced.deletedSessionIds };
  }

  async getUsageStatistics(options = {}) {
    const scope = options.scope === USAGE_SCOPE_ALL ? USAGE_SCOPE_ALL : USAGE_SCOPE_CURRENT;
    const dateRange = options.dateRange === 'today' || options.dateRange === '7d' || options.dateRange === '30d'
      ? options.dateRange
      : 'all';
    const sessionEntries = scope === USAGE_SCOPE_ALL
      ? await this.listClaudeUsageSessions()
      : (await this.getSessions(options)).sessions.map((session) => ({
        session,
        claudeProjectDir: this.claudeProjectDir(),
      }));
    const totalUsage = emptyUsage();
    const sessions = [];
    const daily = new Map();
    const modelUsage = new Map();
    const now = Date.now();
    const todayKey = dateKey(now);
    const todayStart = startOfLocalDay(now);
    const dayDuration = 24 * 60 * 60 * 1000;
    const cutoffTime = dateRange === 'all'
      ? 0
      : dateRange === 'today'
        ? todayStart
        : todayStart - (dateRange === '30d' ? 29 : 6) * dayDuration;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    const currentWeek = { sessions: 0, cost: 0, tokens: 0 };
    const lastWeek = { sessions: 0, cost: 0, tokens: 0 };
    const promptEnhancementUsage = emptyUsage();
    let promptEnhancementCount = 0;
    let promptEnhancementCost = 0;

    for (const { session, claudeProjectDir } of sessionEntries) {
      const history = scope === USAGE_SCOPE_ALL
        ? { messages: await readClaudeSessionMessages({ claudeProjectDir, sessionId: session.id }) }
        : await this.loadSession(session.id);
      if (scope === USAGE_SCOPE_ALL && session.title.startsWith('Session ')) {
        session.title = titleFromMessages(history.messages, session.title);
      }
      const sessionUsage = emptyUsage();
      let sessionTimestamp = 0;
      let sessionCost = 0;
      let sessionModel = null;
      const seenUsageMessageIds = new Set();
      const usageRecords = [];

      for (const message of history.messages || []) {
        // Claude JSONL repeats one assistant usage payload for every content
        // block. ccgui counts one payload per assistant message.id.
        if (message?.role && message.role !== 'assistant') continue;
        const usageMessageId = message?.usageMessageId || message?.messageId || message?.id || message?.uuid;
        if (usageMessageId && seenUsageMessageIds.has(usageMessageId)) continue;
        const usage = usageFromMessage(message);
        if (!usage) continue;
        if (usageMessageId) seenUsageMessageIds.add(usageMessageId);
        const timestamp = messageTimestamp(message, session.updatedAt || now);
        const messageModel = typeof message.model === 'string' && message.model.trim()
          ? message.model.trim()
          : sessionModel || DEFAULT_CLAUDE_MODEL;
        if (!sessionModel && message.model) sessionModel = messageModel;
        const messageCost = usageCost(usage, messageModel);
        usageRecords.push({ timestamp, usage, cost: messageCost, model: messageModel });
      }

      const records = cutoffTime > 0
        ? usageRecords.filter(record => record.timestamp >= cutoffTime)
        : usageRecords;
      if (records.length === 0) continue;

      const usageDates = new Set();
      for (const record of records) {
        addUsage(sessionUsage, record.usage);
        sessionTimestamp = sessionTimestamp === 0 ? record.timestamp : Math.min(sessionTimestamp, record.timestamp);
        sessionCost += record.cost;
        addUsage(totalUsage, record.usage);
        const key = dateKey(record.timestamp);
        const day = daily.get(key) || {
          date: key,
          sessions: 0,
          requestCount: 0,
          usage: emptyUsage(),
          cost: 0,
          modelsUsed: new Set(),
        };
        addUsage(day.usage, record.usage);
        day.cost += record.cost;
        day.requestCount += 1;
        if (record.model) day.modelsUsed.add(record.model);
        daily.set(key, day);
        usageDates.add(key);
      }

      for (const key of usageDates) {
        daily.get(key).sessions += 1;
      }

      const resolvedSessionModel = sessionModel || DEFAULT_CLAUDE_MODEL;
      const model = modelUsage.get(resolvedSessionModel) || {
        model: resolvedSessionModel,
        totalCost: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        sessionCount: 0,
      };
      model.totalCost += sessionCost;
      model.totalTokens += sessionUsage.totalTokens;
      model.inputTokens += sessionUsage.inputTokens;
      model.outputTokens += sessionUsage.outputTokens;
      model.cacheCreationTokens += sessionUsage.cacheWriteTokens;
      model.cacheReadTokens += sessionUsage.cacheReadTokens;
      model.sessionCount += 1;
      modelUsage.set(resolvedSessionModel, model);

      const week = sessionTimestamp > oneWeekAgo
        ? currentWeek
        : sessionTimestamp > twoWeeksAgo ? lastWeek : null;
      if (week) {
        week.sessions += 1;
        week.cost += sessionCost;
        week.tokens += sessionUsage.totalTokens;
      }

      sessions.push({
        sessionId: session.id,
        timestamp: sessionTimestamp || session.updatedAt || now,
        model: resolvedSessionModel,
        usage: sessionUsage,
        cost: sessionCost,
        summary: session.title,
      });
    }

    if (this.promptEnhancementUsage && typeof this.promptEnhancementUsage.list === 'function') {
      const ledgerRecords = await this.promptEnhancementUsage.list();
      for (const record of ledgerRecords) {
        const recordCwd = normalizeWorkspacePath(record.cwd);
        if (scope === USAGE_SCOPE_CURRENT && recordCwd !== this.cwd) continue;
        if (cutoffTime > 0 && record.timestamp < cutoffTime) continue;

        const usage = usageFromRaw(record.usage);
        if (!usage) continue;

        const cost = usageCost(usage, record.model);
        promptEnhancementCount += 1;
        promptEnhancementCost += cost;
        addUsage(promptEnhancementUsage, usage);
        addUsage(totalUsage, usage);

        const key = dateKey(record.timestamp);
        const day = daily.get(key) || {
          date: key,
          sessions: 0,
          requestCount: 0,
          usage: emptyUsage(),
          cost: 0,
          modelsUsed: new Set(),
        };
        addUsage(day.usage, usage);
        day.cost += cost;
        day.requestCount += 1;
        if (record.model) day.modelsUsed.add(record.model);
        daily.set(key, day);

        const model = modelUsage.get(record.model) || {
          model: record.model,
          totalCost: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          sessionCount: 0,
        };
        model.totalCost += cost;
        model.totalTokens += usage.totalTokens;
        model.inputTokens += usage.inputTokens;
        model.outputTokens += usage.outputTokens;
        model.cacheCreationTokens += usage.cacheWriteTokens;
        model.cacheReadTokens += usage.cacheReadTokens;
        modelUsage.set(record.model, model);
      }
    }

    const dailyUsage = [...daily.values()]
      .map(day => ({ ...day, modelsUsed: [...day.modelsUsed] }))
      .sort((left, right) => left.date.localeCompare(right.date));
    const today = daily.get(todayKey);
    const todayUsage = today
      ? {
        ...today.usage,
        requestCount: today.requestCount,
        sessions: today.sessions,
        cost: today.cost,
      }
      : {
        ...emptyUsage(),
        requestCount: 0,
        sessions: 0,
        cost: 0,
      };

    const trend = (current, previous) => previous === 0 ? 0 : ((current - previous) / previous) * 100;
    const totalSessions = sessions.length;

    return {
      type: 'usage_statistics',
      scope,
      dateRange,
      projectPath: scope === USAGE_SCOPE_ALL ? 'all' : this.cwd,
      projectName: scope === USAGE_SCOPE_ALL ? 'All Projects' : path.basename(this.cwd),
      totalSessions,
      totalUsage,
      promptEnhancementCount,
      promptEnhancementUsage,
      promptEnhancementCost,
      estimatedCost: currentWeek.cost + lastWeek.cost + sessions
        .filter(session => session.timestamp <= twoWeeksAgo)
        .reduce((total, session) => total + session.cost, 0) + promptEnhancementCost,
      sessions,
      dailyUsage,
      todayUsage,
      weeklyComparison: {
        currentWeek,
        lastWeek,
        trends: {
          sessions: trend(currentWeek.sessions, lastWeek.sessions),
          cost: trend(currentWeek.cost, lastWeek.cost),
          tokens: trend(currentWeek.tokens, lastWeek.tokens),
        },
      },
      byModel: [...modelUsage.values()]
        .filter(model => model.totalTokens > 0)
        .sort((left, right) => right.totalCost - left.totalCost),
      lastUpdated: now,
    };
  }

  async loadSession(sessionId) {
    const projectIndex = await this.readProjectIndex();
    if (!projectIndex.some((session) => session.id === sessionId)) {
      return { type: 'session_history', sessionId, messages: [] };
    }

    let messages;
    const claudeHistoryFile = path.join(this.claudeProjectDir(), `${sessionId}.jsonl`);
    if (await fileExists(claudeHistoryFile)) {
      // Claude JSONL is the source of truth used by ccgui. The ccnexus cache
      // remains a fallback for sessions that have no readable Claude history.
      messages = await readClaudeSessionMessages({
        claudeProjectDir: this.claudeProjectDir(),
        sessionId,
      });
      if (messages.length > 0) {
        return { type: 'session_history', sessionId, messages };
      }
    }

    try {
      messages = JSON.parse(await fs.readFile(sessionFile(this.sessionsDir, sessionId), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      messages = [];
    }
    if (messages.length === 0) {
      messages = await readClaudeSessionMessages({
        claudeProjectDir: this.claudeProjectDir(),
        sessionId,
      });
    }
    return { type: 'session_history', sessionId, messages };
  }

  async appendMessage(sessionId, message) {
    if (!message || typeof message !== 'object') throw new Error('Message is required');
    const current = await this.loadSession(sessionId);
    const messages = Array.isArray(current.messages) ? current.messages : [];
    const nextMessage = {
      ...message,
      sessionId,
      timestamp: message.timestamp ?? Date.now(),
    };
    messages.push(nextMessage);
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(sessionFile(this.sessionsDir, sessionId), JSON.stringify(messages, null, 2), 'utf8');
    await this.saveSession({
      id: sessionId,
      title: message.role === 'user' && Array.isArray(message.content)
        ? (message.content.find((block) => block?.type === 'text')?.text || '').slice(0, 60)
        : undefined,
      updatedAt: nextMessage.timestamp,
    });
    return nextMessage;
  }

  async renameSession(sessionId, title) {
    if (!title?.trim()) throw new Error('Session title is required');
    await this.saveSession({ id: sessionId, title: title.trim() });
    return { type: 'session_renamed', session_id: sessionId, title: title.trim() };
  }

  async toggleFavoriteSession(sessionId) {
    const index = await this.readProjectIndex();
    const session = index.find((entry) => entry.id === sessionId);
    if (!session) throw new Error('Session not found');

    const isFavorite = !Boolean(session.isFavorite);
    const nextIndex = index.map((entry) => {
      if (entry.id !== sessionId) return entry;
      const next = { ...entry, isFavorite };
      if (isFavorite) next.favoritedAt = Date.now();
      else delete next.favoritedAt;
      return next;
    });
    await this.writeProjectIndex(nextIndex);
    const updated = nextIndex.find((entry) => entry.id === sessionId);
    return {
      type: 'session_favorite_changed',
      sessionId,
      isFavorite,
      favoritedAt: updated?.favoritedAt,
    };
  }

  async deleteSession(sessionId) {
    const messageFile = sessionFile(this.sessionsDir, sessionId);
    const claudeHistoryFile = path.join(this.claudeProjectDir(), `${sessionId}.jsonl`);
    const index = await this.readProjectIndex();
    try {
      await fs.unlink(messageFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      // Claude JSONL is the authoritative history source. Delete it together
      // with the ccNexus index so a later sync does not resurrect the session.
      await fs.unlink(claudeHistoryFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await this.writeProjectIndex(index.filter((entry) => entry.id !== sessionId));
    return { type: 'session_deleted', sessionId };
  }
}
