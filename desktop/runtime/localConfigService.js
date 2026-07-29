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

export class LocalConfigService {
  constructor({ homeDir = process.env.HOME || os.homedir() || '/tmp' } = {}) {
    this.homeDir = homeDir;
    this.ccSwitchDbPath = path.join(homeDir, '.cc-switch', 'cc-switch.db');
    this.codemossConfigPath = path.join(homeDir, '.codemoss', 'config.json');
    this.claudeDir = path.join(homeDir, '.claude');
    this.claudeSettingsPath = path.join(this.claudeDir, 'settings.json');
    this.agentsDir = path.join(this.claudeDir, 'agents');
    this.commandsDir = path.join(this.claudeDir, 'commands');
    this.promptsDir = path.join(this.claudeDir, 'prompts');
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

  async writeClaudeSettings(settings) {
    await fs.mkdir(path.dirname(this.claudeSettingsPath), { recursive: true });
    await fs.writeFile(this.claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  }

  async getProviders() {
    const codemossConfig = await this.readCodemossConfig();
    const codemossProviders = this.getCodemossClaudeProviders(codemossConfig);
    const ccSwitchProviders = await this.readCcSwitchProviders();
    const providers = [...codemossProviders, ...ccSwitchProviders];
    const codemossProviderId = this.getCodemossCurrentProviderId(codemossConfig);
    const codemossProvider = providers.find(provider => provider.id === codemossProviderId);
    const settings = await this.readClaudeSettings();
    return {
      providers,
      currentProviderId: codemossProviderId || settings.env?.CC_SWITCH_PROVIDER_ID || null,
      currentEnv: codemossProvider?.settingsConfig?.env || settings.env || {},
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

    const settings = await this.readClaudeSettings();
    settings.env = settings.env || {};
    Object.assign(settings.env, provider.settingsConfig?.env || {});
    if (provider.base_url) settings.env.ANTHROPIC_BASE_URL = provider.base_url;
    if (provider.api_key) settings.env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
    if (provider.model_mapping) {
      const mapping = typeof provider.model_mapping === 'string'
        ? JSON.parse(provider.model_mapping)
        : provider.model_mapping;
      if (mapping.main) settings.env.ANTHROPIC_MODEL = mapping.main;
      if (mapping.sonnet) settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = mapping.sonnet;
      if (mapping.opus) settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = mapping.opus;
      if (mapping.haiku) settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mapping.haiku;
    }
    settings.env.CC_SWITCH_PROVIDER_ID = providerId;
    await this.writeClaudeSettings(settings);
    return { ok: true, provider, env: settings.env };
  }

  async listAgents() {
    try {
      if (!existsSync(this.agentsDir)) return { agents: [] };
      const files = await fs.readdir(this.agentsDir);
      const agents = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(this.agentsDir, file);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        const content = await fs.readFile(filePath, 'utf-8');
        const name = path.basename(file, '.md');
        let description = '';
        for (const line of content.split('\n').slice(0, 10)) {
          if (line.startsWith('description:') || line.startsWith('Description:')) {
            description = line.replace(/^(description|Description):\s*/, '').trim();
            break;
          }
        }
        agents.push({ id: name, name, description: description || `Agent: ${name}`, file: filePath });
      }

      return { agents };
    } catch (err) {
      console.error('[Desktop Agents] Failed to read agents:', err.message);
      return { agents: [] };
    }
  }

  async getAgent(name) {
    const filePath = path.join(this.agentsDir, `${name}.md`);
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(this.agentsDir);
    if (!pathInside(resolvedDir, resolvedPath)) throw new Error('Invalid agent name');
    const content = await fs.readFile(filePath, 'utf-8');
    return { name, content, file: filePath };
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

  async listPrompts() {
    try {
      if (!existsSync(this.promptsDir)) return { prompts: [] };
      const files = await fs.readdir(this.promptsDir);
      const prompts = [];
      for (const file of files) {
        if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
        const filePath = path.join(this.promptsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const name = file.replace(/\.(md|txt)$/, '');
        prompts.push({ name, content, file: filePath });
      }
      return { prompts };
    } catch (err) {
      console.error('[Desktop Prompts] Failed to read prompts:', err.message);
      return { prompts: [] };
    }
  }

  promptPath(name) {
    const filePath = path.join(this.promptsDir, `${name}.md`);
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(this.promptsDir);
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
