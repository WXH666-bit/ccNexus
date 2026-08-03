import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

const BUILT_IN_COMMANDS = [
  { name: 'help', description: 'Show help information', args: '' },
  { name: 'clear', description: 'Clear conversation history', args: '' },
  { name: 'compact', description: 'Compact conversation context', args: '' },
  { name: 'cost', description: 'Show token usage and cost', args: '' },
  { name: 'doctor', description: 'Diagnose issues', args: '' },
  { name: 'init', description: 'Initialize project', args: '' },
  { name: 'login', description: 'Login to Claude', args: '' },
  { name: 'logout', description: 'Logout from Claude', args: '' },
  { name: 'status', description: 'Show current status', args: '' },
  { name: 'config', description: 'Show configuration', args: '' },
];

function pathInside(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseJsonObject(raw, fallback = {}) {
  try {
    if (!raw || typeof raw !== 'string') return fallback;
    const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeProvider(id, provider = {}, source = 'codemoss') {
  const settingsConfig = provider.settingsConfig && typeof provider.settingsConfig === 'object'
    ? provider.settingsConfig
    : {};
  return {
    ...provider,
    id,
    name: provider.name || provider.remark || id,
    source,
    settingsConfig: {
      ...settingsConfig,
      env: { ...(settingsConfig.env || {}) },
    },
  };
}

function isValidMcpServerConfig(serverConfig) {
  if (!serverConfig || typeof serverConfig !== 'object') return false;
  const hasCommand = typeof serverConfig.command === 'string' && serverConfig.command.length > 0;
  const hasUrl = typeof serverConfig.url === 'string' && serverConfig.url.length > 0;
  if (!hasCommand && !hasUrl) return false;
  if (serverConfig.args !== undefined && !Array.isArray(serverConfig.args)) return false;
  if (serverConfig.env !== undefined && (!serverConfig.env || typeof serverConfig.env !== 'object')) return false;
  if (serverConfig.headers !== undefined && (!serverConfig.headers || typeof serverConfig.headers !== 'object')) return false;
  return true;
}

function normalizeCwd(cwd) {
  if (!cwd) return '';
  return path.resolve(String(cwd));
}

function findProjectConfig(config, cwd) {
  const normalizedCwd = normalizeCwd(cwd).replace(/\\/g, '/').replace(/\/$/, '');
  const projects = config?.projects;
  if (!normalizedCwd || !projects || typeof projects !== 'object') return null;
  if (projects[normalizedCwd]) return projects[normalizedCwd];

  for (const [projectPath, projectConfig] of Object.entries(projects)) {
    if (projectPath.replace(/\\/g, '/').replace(/\/$/, '') === normalizedCwd) return projectConfig;
  }
  return null;
}

function redactMcpConfig(config) {
  const visible = { ...config };
  for (const key of ['env', 'headers']) {
    if (!visible[key] || typeof visible[key] !== 'object') continue;
    visible[key] = Object.fromEntries(Object.keys(visible[key]).map(name => [name, '***']));
  }
  return visible;
}

function frontmatterValue(content, key) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return '';
  const line = new RegExp(`^${key}:\\s*(.+)$`, 'im').exec(match[1]);
  return line?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
}

export class LocalConfigService {
  constructor({ homeDir = process.env.HOME || os.homedir() || '/tmp' } = {}) {
    this.homeDir = homeDir;
    this.ccSwitchDbPath = path.join(homeDir, '.cc-switch', 'cc-switch.db');
    this.codemossConfigPath = path.join(homeDir, '.codemoss', 'config.json');
    this.claudeDir = path.join(homeDir, '.claude');
    this.claudeJsonPath = path.join(homeDir, '.claude.json');
    this.claudeSettingsPath = path.join(this.claudeDir, 'settings.json');
    this.providerStatePath = path.join(homeDir, '.ccnexus', 'provider-state.json');
    this.agentsDir = path.join(this.claudeDir, 'agents');
    this.commandsDir = path.join(this.claudeDir, 'commands');
    // Claude prompt files are read-only. Prompt edits belong to ccNexus-owned
    // storage so using the desktop UI never mutates Claude Code files.
    this.claudePromptsDir = path.join(this.claudeDir, 'prompts');
    this.promptsDir = path.join(this.homeDir, '.ccnexus', 'prompts');
  }

  async readCcSwitchProviders() {
    try {
      if (!existsSync(this.ccSwitchDbPath)) return [];
      const SQL = await initSqlJs();
      const dbBuffer = await fs.readFile(this.ccSwitchDbPath);
      const db = new SQL.Database(dbBuffer);
      const result = db.exec("SELECT * FROM providers WHERE app_type = 'claude' ORDER BY name");
      if (result.length === 0) {
        db.close();
        return [];
      }
      const columns = result[0].columns;
      const providers = result[0].values.map((row) => {
        const item = {};
        columns.forEach((column, index) => {
          item[column] = row[index];
        });
        const settingsConfig = parseJsonObject(item.settings_config, {});
        const env = { ...(settingsConfig.env || {}) };
        if (item.base_url && !env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = item.base_url;
        if (item.api_key && !env.ANTHROPIC_AUTH_TOKEN) env.ANTHROPIC_AUTH_TOKEN = item.api_key;
        return normalizeProvider(item.id || item.name, {
          ...item,
          name: item.name || item.id,
          settingsConfig: {
            ...settingsConfig,
            env,
          },
        }, 'cc-switch');
      });
      db.close();
      return providers;
    } catch (err) {
      console.error('[Desktop Providers] Failed to read cc-switch database:', err.message);
      return [];
    }
  }

  async readClaudeSettings() {
    try {
      if (!existsSync(this.claudeSettingsPath)) return { env: {} };
      const data = await fs.readFile(this.claudeSettingsPath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('[Desktop Providers] Failed to read Claude settings:', err.message);
      return { env: {} };
    }
  }

  async readCodemossConfig() {
    try {
      if (!existsSync(this.codemossConfigPath)) return {};
      const content = await fs.readFile(this.codemossConfigPath, 'utf-8');
      return parseJsonObject(content, {});
    } catch (err) {
      console.error('[Desktop Providers] Failed to read codemoss config:', err.message);
      return {};
    }
  }

  getCodemossClaudeProviders(config = {}) {
    const claude = config.claude && typeof config.claude === 'object' ? config.claude : {};
    const providers = claude.providers && typeof claude.providers === 'object' ? claude.providers : {};
    return Object.entries(providers).map(([id, provider]) => normalizeProvider(id, provider, 'codemoss'));
  }

  getCodemossCurrentProviderId(config = {}) {
    const claude = config.claude && typeof config.claude === 'object' ? config.claude : {};
    if (Object.prototype.hasOwnProperty.call(claude, 'current') && claude.current !== null) {
      return String(claude.current).trim();
    }
    const providerIds = Object.keys(claude.providers || {});
    return providerIds[0] || '';
  }

  async readProviderState() {
    try {
      const data = await fs.readFile(this.providerStatePath, 'utf8');
      const parsed = parseJsonObject(data, {});
      return typeof parsed.providerId === 'string' ? parsed : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      console.error('[Desktop Providers] Failed to read ccNexus provider state:', error.message);
      return {};
    }
  }

  async writeProviderState(providerId) {
    await fs.mkdir(path.dirname(this.providerStatePath), { recursive: true });
    await fs.writeFile(this.providerStatePath, JSON.stringify({
      providerId,
      updatedAt: Date.now(),
    }, null, 2), 'utf8');
  }

  providerEnvironment(provider) {
    const env = { ...(provider?.settingsConfig?.env || {}) };
    if (provider?.base_url && !env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = provider.base_url;
    if (provider?.api_key && !env.ANTHROPIC_AUTH_TOKEN) env.ANTHROPIC_AUTH_TOKEN = provider.api_key;

    if (provider?.model_mapping) {
      try {
        const mapping = typeof provider.model_mapping === 'string'
          ? JSON.parse(provider.model_mapping)
          : provider.model_mapping;
        if (mapping?.main) env.ANTHROPIC_MODEL = mapping.main;
        if (mapping?.sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = mapping.sonnet;
        if (mapping?.opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = mapping.opus;
        if (mapping?.haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mapping.haiku;
      } catch {
        // Ignore malformed optional provider mapping and keep its base env.
      }
    }

    return env;
  }

  async getProviders() {
    const codemossConfig = await this.readCodemossConfig();
    const codemossProviders = this.getCodemossClaudeProviders(codemossConfig);
    const ccSwitchProviders = await this.readCcSwitchProviders();
    const providers = [...codemossProviders, ...ccSwitchProviders];
    const codemossProviderId = this.getCodemossCurrentProviderId(codemossConfig);
    const providerState = await this.readProviderState();
    const settings = await this.readClaudeSettings();
    const persistedProviderId = providers.some(provider => provider.id === providerState.providerId)
      ? providerState.providerId
      : null;
    const currentProviderId = persistedProviderId || codemossProviderId || settings.env?.CC_SWITCH_PROVIDER_ID || null;
    const currentProvider = providers.find(provider => provider.id === currentProviderId);
    return {
      providers,
      currentProviderId,
      currentEnv: currentProvider ? this.providerEnvironment(currentProvider) : settings.env || {},
    };
  }

  async switchProvider(providerId) {
    if (!providerId) throw new Error('Provider ID required');
    const providers = [
      ...this.getCodemossClaudeProviders(await this.readCodemossConfig()),
      ...await this.readCcSwitchProviders(),
    ];
    const provider = providers.find(item => item.id === providerId || item.name === providerId);
    if (!provider) throw new Error('Provider not found');

    await this.writeProviderState(provider.id);
    return { ok: true, provider, env: this.providerEnvironment(provider) };
  }

  async listMcpServers(cwd) {
    const result = { servers: [], disabled: [], invalid: [], scope: 'global' };
    try {
      if (!existsSync(this.claudeJsonPath)) return result;
      const config = parseJsonObject(await fs.readFile(this.claudeJsonPath, 'utf8'), {});
      const projectConfig = findProjectConfig(config, cwd);
      const projectServers = projectConfig?.mcpServers;
      const hasProjectServers = projectServers && typeof projectServers === 'object'
        && Object.keys(projectServers).length > 0;
      const serverConfig = hasProjectServers
        ? projectServers
        : (config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {});
      const disabledServers = new Set(
        Array.isArray(hasProjectServers ? projectConfig.disabledMcpServers : config.disabledMcpServers)
          ? (hasProjectServers ? projectConfig.disabledMcpServers : config.disabledMcpServers)
          : [],
      );

      result.scope = hasProjectServers ? 'project' : 'global';
      for (const [id, server] of Object.entries(serverConfig)) {
        if (disabledServers.has(id)) {
          result.disabled.push(id);
        } else if (isValidMcpServerConfig(server)) {
          result.servers.push({
            id,
            name: id,
            enabled: true,
            scope: result.scope,
            config: redactMcpConfig(server),
          });
        } else {
          result.invalid.push({ id, reason: 'Missing command/url or invalid config' });
        }
      }
    } catch (error) {
      console.error('[Desktop MCP] Failed to read Claude MCP state:', error.message);
    }
    return result;
  }

  async readSkillsDirectory(directory, scope) {
    if (!existsSync(directory)) return {};
    const skills = {};
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      let skillPath = path.join(directory, entry.name);
      let type = 'file';
      if (entry.isDirectory()) {
        type = 'directory';
        const candidates = ['SKILL.md', 'skill.md'];
        const candidate = candidates.find(name => existsSync(path.join(skillPath, name)));
        if (!candidate) continue;
        skillPath = path.join(skillPath, candidate);
      } else if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
        continue;
      }

      const content = await fs.readFile(skillPath, 'utf8');
      const stat = await fs.stat(skillPath);
      const fallbackName = type === 'directory'
        ? entry.name
        : entry.name.replace(/\.md$/i, '');
      const name = frontmatterValue(content, 'name') || fallbackName;
      const description = frontmatterValue(content, 'description');
      skills[name] = {
        id: `${scope}-${name}`,
        name,
        type,
        scope,
        path: type === 'directory' ? path.dirname(skillPath) : skillPath,
        enabled: true,
        ...(description ? { description } : {}),
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      };
    }

    return skills;
  }

  async listSkills(cwd) {
    const workspace = normalizeCwd(cwd || process.cwd());
    try {
      return {
        global: await this.readSkillsDirectory(path.join(this.claudeDir, 'skills'), 'global'),
        local: await this.readSkillsDirectory(path.join(workspace, '.claude', 'skills'), 'local'),
      };
    } catch (error) {
      console.error('[Desktop Skills] Failed to read Claude Skills:', error.message);
      return { global: {}, local: {} };
    }
  }

  async listAgents(cwd) {
    try {
      const directories = [
        { directory: path.join(normalizeCwd(cwd || process.cwd()), '.claude', 'agents'), source: 'project' },
        { directory: this.agentsDir, source: 'user' },
      ];
      const byId = new Map();
      for (const { directory, source } of directories) {
        if (!existsSync(directory)) continue;
        const files = await fs.readdir(directory);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const filePath = path.join(directory, file);
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) continue;
          const content = await fs.readFile(filePath, 'utf-8');
          const name = path.basename(file, '.md');
          const description = frontmatterValue(content, 'description')
            || content.split('\n').slice(0, 10).find(line => /^description:/i.test(line))?.replace(/^description:\s*/i, '').trim()
            || `Agent: ${name}`;
          byId.set(name, { id: name, name, description, file: filePath, source });
        }
      }
      return { agents: [...byId.values()] };
    } catch (err) {
      console.error('[Desktop Agents] Failed to read agents:', err.message);
      return { agents: [] };
    }
  }

  async getAgent(name, cwd) {
    if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid agent name');
    }
    const directories = [
      path.join(normalizeCwd(cwd || process.cwd()), '.claude', 'agents'),
      this.agentsDir,
    ];
    for (const directory of directories) {
      const filePath = path.join(directory, `${name}.md`);
      const resolvedPath = path.resolve(filePath);
      const resolvedDir = path.resolve(directory);
      if (!pathInside(resolvedDir, resolvedPath)) continue;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return { name, content, file: filePath };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    throw new Error('Agent not found');
  }

  async listCommands() {
    const commands = BUILT_IN_COMMANDS.map(command => ({ ...command, source: 'built-in' }));
    try {
      if (!existsSync(this.commandsDir)) return { commands };
      const files = await fs.readdir(this.commandsDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(this.commandsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const name = file.replace(/\.md$/, '');
        let description = '';
        let args = '';
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const descMatch = frontmatter.match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
          const argsMatch = frontmatter.match(/args:\s*(.+)/);
          if (argsMatch) args = argsMatch[1].trim();
        }
        commands.push({ name, description: description || `Custom command: ${name}`, args, source: 'custom' });
      }
    } catch (err) {
      console.error('[Desktop Commands] Failed to read commands:', err.message);
    }
    return { commands };
  }

  async readPromptDirectory(directory, source) {
    if (!existsSync(directory)) return [];
    const files = await fs.readdir(directory);
    const prompts = [];
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
      const filePath = path.join(directory, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(filePath, 'utf-8');
      const name = file.replace(/\.(md|txt)$/, '');
      prompts.push({ name, content, file: filePath, source, readOnly: source === 'claude' });
    }
    return prompts;
  }

  async listPrompts() {
    try {
      const promptsByName = new Map();
      for (const prompt of await this.readPromptDirectory(this.claudePromptsDir, 'claude')) {
        promptsByName.set(prompt.name, prompt);
      }
      // ccNexus-owned prompts override the display entry with the same name,
      // while leaving the original Claude prompt untouched on disk.
      for (const prompt of await this.readPromptDirectory(this.promptsDir, 'ccnexus')) {
        promptsByName.set(prompt.name, prompt);
      }
      return { prompts: [...promptsByName.values()] };
    } catch (err) {
      console.error('[Desktop Prompts] Failed to read prompts:', err.message);
      return { prompts: [] };
    }
  }

  promptPath(name, directory = this.promptsDir) {
    const filePath = path.join(directory, `${name}.md`);
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(directory);
    if (!pathInside(resolvedDir, resolvedPath)) throw new Error('Invalid prompt name');
    return filePath;
  }

  async savePrompt({ name, content } = {}) {
    if (!name || !content) throw new Error('Name and content are required');
    await fs.mkdir(this.promptsDir, { recursive: true });
    const filePath = this.promptPath(name);
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, file: filePath };
  }

  async deletePrompt(name) {
    const filePath = this.promptPath(name);
    if (!existsSync(filePath)) throw new Error('Prompt not found');
    await fs.unlink(filePath);
    return { success: true };
  }
}
