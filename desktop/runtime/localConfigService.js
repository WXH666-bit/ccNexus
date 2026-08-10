import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

async function readJsonObject(filePath, { allowMissing = false } = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseJsonObject(raw, null);
    if (!parsed || Array.isArray(parsed)) {
      throw new Error(`Invalid JSON object: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryFile, filePath);
  } finally {
    try {
      await fs.unlink(temporaryFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

const SPECIAL_PROVIDER_IDS = Object.freeze({
  LOCAL_SETTINGS: '__local_settings_json__',
  CLI_LOGIN: '__cli_login__',
});

function createLocalSettingsProvider(settings, isActive) {
  const env = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  const modelEnv = Object.fromEntries(
    ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']
      .filter(key => env[key] !== undefined && env[key] !== null)
      .map(key => [key, String(env[key])]),
  );
  return {
    id: SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS,
    name: '使用本地 settings.json',
    source: 'runtime',
    isActive,
    isLocalProvider: true,
    settingsConfig: { env: modelEnv },
  };
}

function createCliLoginProvider(isActive) {
  return {
    id: SPECIAL_PROVIDER_IDS.CLI_LOGIN,
    name: '使用 CLI 登录信息',
    source: 'runtime',
    isActive,
    isCliLoginProvider: true,
    settingsConfig: { env: {} },
  };
}

function isSpecialProviderId(providerId) {
  return providerId === SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS
    || providerId === SPECIAL_PROVIDER_IDS.CLI_LOGIN;
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

function findProjectEntry(config, cwd) {
  const normalizedCwd = normalizeCwd(cwd).replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalizedCwd) throw new Error('Workspace path is required for project MCP scope');
  if (!config.projects || typeof config.projects !== 'object' || Array.isArray(config.projects)) {
    config.projects = {};
  }

  for (const [projectPath, projectConfig] of Object.entries(config.projects)) {
    if (projectPath.replace(/\\/g, '/').replace(/\/$/, '') === normalizedCwd) {
      if (!projectConfig || typeof projectConfig !== 'object' || Array.isArray(projectConfig)) {
        config.projects[projectPath] = {};
      }
      return { key: projectPath, value: config.projects[projectPath] };
    }
  }

  config.projects[normalizedCwd] = {};
  return { key: normalizedCwd, value: config.projects[normalizedCwd] };
}

function ensureMcpScope(config, cwd, scope) {
  if (scope === 'global') return config;
  if (scope !== 'project') throw new Error('Invalid MCP scope');
  return findProjectEntry(config, cwd).value;
}

function ensureMcpServersContainer(scopeConfig) {
  if (!scopeConfig.mcpServers || typeof scopeConfig.mcpServers !== 'object' || Array.isArray(scopeConfig.mcpServers)) {
    scopeConfig.mcpServers = {};
  }
  return scopeConfig.mcpServers;
}

function ensureDisabledList(scopeConfig) {
  if (!Array.isArray(scopeConfig.disabledMcpServers)) scopeConfig.disabledMcpServers = [];
  return scopeConfig.disabledMcpServers;
}

function removeDisabledId(scopeConfig, id) {
  if (!Array.isArray(scopeConfig.disabledMcpServers)) return;
  scopeConfig.disabledMcpServers = scopeConfig.disabledMcpServers.filter(item => item !== id);
}

function validateMcpId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\0\r\n]/.test(id)) {
    throw new Error('Invalid MCP server id');
  }
  return id.trim();
}

function normalizeMcpWriteConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('MCP server config must be an object');
  }
  const normalized = JSON.parse(JSON.stringify(config));
  delete normalized.id;
  delete normalized.name;
  delete normalized.scope;
  delete normalized.enabled;
  if (!isValidMcpServerConfig(normalized)) throw new Error('MCP server config requires a valid command or url');
  return normalized;
}

function redactMcpConfig(config) {
  const visible = { ...config };
  for (const key of ['env', 'headers']) {
    if (!visible[key] || typeof visible[key] !== 'object') continue;
    visible[key] = Object.fromEntries(Object.keys(visible[key]).map(name => [name, '***']));
  }
  return visible;
}

function validateSkillName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes('..')) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  return name;
}

function javaStringHashCode(value) {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function skillDirectories(homeDir, scope, cwd) {
  if (scope === 'global') {
    return {
      active: path.join(homeDir, '.claude', 'skills'),
      managed: path.join(homeDir, '.codemoss', 'skills', 'global'),
    };
  }
  if (scope !== 'local') throw new Error('Invalid skill scope');
  const workspace = normalizeCwd(cwd || process.cwd());
  if (!workspace) throw new Error('Workspace path is required for local skills');
  const workspaceName = path.basename(workspace) || 'workspace';
  return {
    active: path.join(workspace, '.claude', 'skills'),
    managed: path.join(homeDir, '.codemoss', 'skills', `${workspaceName}_${javaStringHashCode(workspace)}`),
  };
}

function skillPath(directory, name) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedPath = path.resolve(directory, name);
  if (!pathInside(resolvedDirectory, resolvedPath) || resolvedPath === resolvedDirectory) {
    throw new Error('Invalid skill path');
  }
  return resolvedPath;
}

async function copyDirectory(source, target) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    } else {
      throw new Error(`Unsupported file in Skill: ${entry.name}`);
    }
  }
}

async function moveDirectory(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EEXIST'].includes(error.code)) throw error;
    if (existsSync(target)) throw new Error('A Skill with the same name already exists at the target');
    await copyDirectory(source, target);
    await fs.rm(source, { recursive: true, force: true });
  }
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
    this.claudeDir = path.join(homeDir, '.claude');
    this.claudeJsonPath = path.join(homeDir, '.claude.json');
    this.claudeSettingsPath = path.join(this.claudeDir, 'settings.json');
    this.codemossSkillsDir = path.join(homeDir, '.codemoss', 'skills');
    this.providerStatePath = path.join(homeDir, '.ccnexus', 'provider-state.json');
    this.agentsDir = path.join(this.claudeDir, 'agents');
    this.commandsDir = path.join(this.claudeDir, 'commands');
    // Claude prompt files are read-only. Prompt edits belong to ccNexus-owned
    // storage so using the desktop UI never mutates Claude Code files.
    this.claudePromptsDir = path.join(this.claudeDir, 'prompts');
    this.promptsDir = path.join(this.homeDir, '.ccnexus', 'prompts');
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

  async updateClaudeJson(mutator) {
    if (typeof mutator !== 'function') throw new Error('Claude config mutator is required');
    const current = await readJsonObject(this.claudeJsonPath, { allowMissing: true });
    const draft = JSON.parse(JSON.stringify(current));
    const next = await mutator(draft);
    const result = next === undefined ? draft : next;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Claude config mutator must return an object');
    }
    await writeJsonAtomic(this.claudeJsonPath, result);
    return result;
  }

  async syncMcpToClaudeSettings() {
    const claudeConfig = await readJsonObject(this.claudeJsonPath, { allowMissing: true });
    const settings = await readJsonObject(this.claudeSettingsPath, { allowMissing: true });

    for (const key of ['mcpServers', 'disabledMcpServers']) {
      if (Object.prototype.hasOwnProperty.call(claudeConfig, key)) {
        settings[key] = JSON.parse(JSON.stringify(claudeConfig[key]));
      }
    }

    await writeJsonAtomic(this.claudeSettingsPath, settings);
    return settings;
  }

  async writeProviderState(providerId) {
    await fs.mkdir(path.dirname(this.providerStatePath), { recursive: true });
    await fs.writeFile(this.providerStatePath, JSON.stringify({
      providerId,
      updatedAt: Date.now(),
    }, null, 2), 'utf8');
  }

  async clearProviderState() {
    try {
      await fs.unlink(this.providerStatePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  providerRuntimeEnvironment(_provider, settings = {}) {
    return settings?.env && typeof settings.env === 'object' ? { ...settings.env } : {};
  }

  async getProviders() {
    const providerState = await this.readProviderState();
    const settings = await this.readClaudeSettings();
    const knownProviderIds = new Set([
      SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS,
      SPECIAL_PROVIDER_IDS.CLI_LOGIN,
    ]);
    const persistedProviderId = knownProviderIds.has(providerState.providerId)
      ? providerState.providerId
      : null;
    const currentProviderId = persistedProviderId
      || (existsSync(this.claudeSettingsPath) ? SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS : null);
    const providers = [
      createLocalSettingsProvider(settings, currentProviderId === SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS),
      createCliLoginProvider(currentProviderId === SPECIAL_PROVIDER_IDS.CLI_LOGIN),
    ];
    const currentProvider = providers.find(provider => provider.id === currentProviderId);
    return {
      providers,
      currentProviderId,
      currentEnv: currentProvider
        ? this.providerRuntimeEnvironment(currentProvider, settings)
        : settings.env || {},
      providerMode: currentProviderId || null,
    };
  }

  async switchProvider(providerId) {
    if (!providerId) throw new Error('Provider ID required');
    const settings = await this.readClaudeSettings();
    let provider;
    if (providerId === SPECIAL_PROVIDER_IDS.LOCAL_SETTINGS) {
      if (!existsSync(this.claudeSettingsPath)) {
        throw new Error('Claude settings.json not found');
      }
      try {
        JSON.parse(await fs.readFile(this.claudeSettingsPath, 'utf8'));
      } catch {
        throw new Error('Claude settings.json is invalid JSON');
      }
      provider = createLocalSettingsProvider(settings, true);
    } else if (providerId === SPECIAL_PROVIDER_IDS.CLI_LOGIN) {
      provider = createCliLoginProvider(true);
    } else {
      provider = null;
    }
    if (!provider) throw new Error('Provider not found');

    await this.writeProviderState(provider.id);
    return {
      ok: true,
      provider,
      env: this.providerRuntimeEnvironment(provider, settings),
      providerMode: provider.id,
    };
  }

  async listMcpServers(cwd) {
    const result = {
      servers: [],
      disabled: [],
      invalid: [],
      scope: 'merged',
      scopeSummary: { global: 0, project: 0 },
    };
    try {
      if (!existsSync(this.claudeJsonPath)) return result;
      const config = await readJsonObject(this.claudeJsonPath);
      const projectConfig = findProjectConfig(config, cwd);
      const globalServers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
        ? config.mcpServers
        : {};
      const projectServers = projectConfig?.mcpServers && typeof projectConfig.mcpServers === 'object' && !Array.isArray(projectConfig.mcpServers)
        ? projectConfig.mcpServers
        : {};
      const mergedServers = new Map(Object.entries(globalServers).map(([id, server]) => [id, { server, scope: 'global' }]));
      for (const [id, server] of Object.entries(projectServers)) {
        mergedServers.set(id, { server, scope: 'project' });
      }

      const globalDisabled = new Set(Array.isArray(config.disabledMcpServers) ? config.disabledMcpServers : []);
      const projectDisabled = new Set(Array.isArray(projectConfig?.disabledMcpServers) ? projectConfig.disabledMcpServers : []);
      const disabledServers = new Set([...globalDisabled, ...projectDisabled]);

      for (const [id, { server, scope }] of mergedServers) {
        const redactedConfig = redactMcpConfig(server);
        if (disabledServers.has(id)) {
          result.disabled.push({
            id,
            scope: projectDisabled.has(id) ? 'project' : scope,
            reason: 'Server is disabled',
          });
          result.scopeSummary[scope] += 1;
        } else if (isValidMcpServerConfig(server)) {
          result.servers.push({
            id,
            name: id,
            enabled: true,
            scope,
            config: redactedConfig,
            redactedConfig,
          });
          result.scopeSummary[scope] += 1;
        } else {
          result.invalid.push({
            id,
            scope,
            reason: 'Missing command/url or invalid config',
            config: redactedConfig,
          });
          result.scopeSummary[scope] += 1;
        }
      }

      for (const id of disabledServers) {
        if (mergedServers.has(id)) continue;
        result.disabled.push({
          id,
          scope: projectDisabled.has(id) ? 'project' : 'global',
          reason: 'Server is disabled',
        });
      }
    } catch (error) {
      console.error('[Desktop MCP] Failed to read Claude MCP state:', error.message);
      result.error = error.message;
    }
    return result;
  }

  async getMcpServerRuntimeSnapshot(cwd) {
    const result = {
      servers: [],
      disabled: [],
      invalid: [],
    };
    try {
      if (!existsSync(this.claudeJsonPath)) return result;
      const config = await readJsonObject(this.claudeJsonPath);
      const projectConfig = findProjectConfig(config, cwd);
      const globalServers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
        ? config.mcpServers
        : {};
      const projectServers = projectConfig?.mcpServers && typeof projectConfig.mcpServers === 'object' && !Array.isArray(projectConfig.mcpServers)
        ? projectConfig.mcpServers
        : {};
      const mergedServers = new Map(Object.entries(globalServers).map(([id, server]) => [id, { server, scope: 'global' }]));
      for (const [id, server] of Object.entries(projectServers)) {
        mergedServers.set(id, { server, scope: 'project' });
      }
      const globalDisabled = new Set(Array.isArray(config.disabledMcpServers) ? config.disabledMcpServers : []);
      const projectDisabled = new Set(Array.isArray(projectConfig?.disabledMcpServers) ? projectConfig.disabledMcpServers : []);
      const disabledServers = new Set([...globalDisabled, ...projectDisabled]);

      for (const [id, { server, scope }] of mergedServers) {
        const runtimeServer = {
          id,
          name: id,
          scope,
          config: JSON.parse(JSON.stringify(server)),
        };
        if (disabledServers.has(id)) {
          result.disabled.push({
            id,
            scope: projectDisabled.has(id) ? 'project' : scope,
            reason: 'Server is disabled',
          });
        } else if (isValidMcpServerConfig(server)) {
          result.servers.push(runtimeServer);
        } else {
          result.invalid.push({
            id,
            scope,
            reason: 'Missing command/url or invalid config',
            config: runtimeServer.config,
          });
        }
      }

      for (const id of disabledServers) {
        if (mergedServers.has(id)) continue;
        result.disabled.push({
          id,
          scope: projectDisabled.has(id) ? 'project' : 'global',
          reason: 'Server is disabled',
        });
      }
    } catch (error) {
      console.error('[Desktop MCP] Failed to read runtime MCP state:', error.message);
      result.error = error.message;
    }
    return result;
  }

  async getMcpServerForEdit({ id, scope = 'global', cwd } = {}) {
    const serverId = validateMcpId(id);
    const config = await readJsonObject(this.claudeJsonPath);
    const scopeConfig = scope === 'global' ? config : findProjectConfig(config, cwd);
    if (scope !== 'global' && scope !== 'project') throw new Error('Invalid MCP scope');
    const server = scopeConfig?.mcpServers?.[serverId];
    if (!server || typeof server !== 'object' || Array.isArray(server)) {
      throw new Error('MCP server not found');
    }
    return {
      id: serverId,
      name: serverId,
      scope,
      config: JSON.parse(JSON.stringify(server)),
    };
  }

  async saveMcpServer({ id, config, scope = 'global', cwd } = {}) {
    const serverId = validateMcpId(id);
    const serverConfig = normalizeMcpWriteConfig(config);
    await this.updateClaudeJson((next) => {
      const scopeConfig = ensureMcpScope(next, cwd, scope);
      ensureMcpServersContainer(scopeConfig)[serverId] = serverConfig;
      removeDisabledId(scopeConfig, serverId);
      return next;
    });
    await this.syncMcpToClaudeSettings();
    return this.listMcpServers(cwd);
  }

  async deleteMcpServer({ id, scope = 'global', cwd } = {}) {
    const serverId = validateMcpId(id);
    await this.updateClaudeJson((next) => {
      const scopeConfig = ensureMcpScope(next, cwd, scope);
      const servers = ensureMcpServersContainer(scopeConfig);
      if (!Object.prototype.hasOwnProperty.call(servers, serverId)) {
        throw new Error('MCP server not found');
      }
      delete servers[serverId];
      removeDisabledId(scopeConfig, serverId);
      return next;
    });
    await this.syncMcpToClaudeSettings();
    return this.listMcpServers(cwd);
  }

  async toggleMcpServer({ id, enabled, scope = 'global', cwd } = {}) {
    const serverId = validateMcpId(id);
    if (typeof enabled !== 'boolean') throw new Error('MCP enabled state must be boolean');
    await this.updateClaudeJson((next) => {
      const scopeConfig = ensureMcpScope(next, cwd, scope);
      const servers = ensureMcpServersContainer(scopeConfig);
      if (!Object.prototype.hasOwnProperty.call(servers, serverId)) {
        throw new Error('MCP server not found');
      }
      const disabled = ensureDisabledList(scopeConfig);
      if (enabled) {
        removeDisabledId(scopeConfig, serverId);
        if (scope === 'project') removeDisabledId(next, serverId);
      } else if (!disabled.includes(serverId)) {
        disabled.push(serverId);
      }
      return next;
    });
    await this.syncMcpToClaudeSettings();
    return this.listMcpServers(cwd);
  }

  async readSkillsDirectory(directory, scope, enabled) {
    if (!existsSync(directory)) return {};
    const skills = {};
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directoryPath = path.join(directory, entry.name);
      const skillFileName = ['SKILL.md', 'skill.md'].find(name => existsSync(path.join(directoryPath, name)));
      if (!skillFileName) continue;

      const skillFilePath = path.join(directoryPath, skillFileName);
      const content = await fs.readFile(skillFilePath, 'utf8');
      const stat = await fs.stat(directoryPath);
      const displayName = frontmatterValue(content, 'name') || entry.name;
      const description = frontmatterValue(content, 'description');
      const id = `${scope}-${entry.name}${enabled ? '' : '-disabled'}`;
      const skill = {
        id,
        skillName: entry.name,
        name: displayName,
        type: 'directory',
        scope,
        path: directoryPath,
        enabled,
        ...(description ? { description } : { warning: 'invalid_frontmatter' }),
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      };
      skills[id] = skill;
      // Keep the old name lookup available without duplicating the item in Object.values().
      Object.defineProperty(skills, entry.name, {
        configurable: true,
        enumerable: false,
        value: skill,
      });
    }

    return skills;
  }

  async listSkills(cwd) {
    try {
      const directories = {
        global: skillDirectories(this.homeDir, 'global', cwd),
        local: skillDirectories(this.homeDir, 'local', cwd),
      };
      const result = {};
      for (const [scope, locations] of Object.entries(directories)) {
        result[scope] = {};
        for (const records of [
          await this.readSkillsDirectory(locations.active, scope, true),
          await this.readSkillsDirectory(locations.managed, scope, false),
        ]) {
          for (const key of Object.keys(records)) result[scope][key] = records[key];
          for (const key of Object.getOwnPropertyNames(records)) {
            if (Object.prototype.propertyIsEnumerable.call(records, key)) continue;
            Object.defineProperty(result[scope], key, {
              configurable: true,
              enumerable: false,
              value: records[key],
            });
          }
        }
      }
      return result;
    } catch (error) {
      console.error('[Desktop Skills] Failed to read Claude Skills:', error.message);
      return { global: {}, local: {} };
    }
  }

  async importSkills({ sourcePaths = [], scope = 'global', cwd } = {}) {
    const paths = Array.isArray(sourcePaths) ? sourcePaths : [];
    const locations = skillDirectories(this.homeDir, scope, cwd);
    const imported = [];
    const errors = [];
    await fs.mkdir(locations.active, { recursive: true });

    for (const sourcePath of paths) {
      try {
        if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new Error('Source path is required');
        const source = path.resolve(sourcePath);
        const sourceStat = await fs.stat(source);
        if (!sourceStat.isDirectory()) throw new Error('Only Skill directories can be imported');
        const name = validateSkillName(path.basename(source));
        const target = skillPath(locations.active, name);
        if (existsSync(target)) throw new Error(`Skill already exists: ${name}`);
        const skillFile = ['SKILL.md', 'skill.md'].find(file => existsSync(path.join(source, file)));
        if (!skillFile) throw new Error('Skill directory must contain SKILL.md or skill.md');

        const temporary = path.join(locations.active, `.${name}.ccnexus-import-${process.pid}-${Date.now()}`);
        try {
          await copyDirectory(source, temporary);
          await fs.rename(temporary, target);
        } finally {
          if (existsSync(temporary)) await fs.rm(temporary, { recursive: true, force: true });
        }
        const skillState = await this.readSkillsDirectory(locations.active, scope, true);
        imported.push(skillState[`${scope}-${name}`] || {
          id: `${scope}-${name}`,
          name,
          type: 'directory',
          scope,
          path: target,
          enabled: true,
        });
      } catch (error) {
        errors.push({ path: sourcePath, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return {
      success: imported.length > 0,
      count: imported.length,
      total: paths.length,
      imported,
      ...(errors.length ? { errors } : {}),
    };
  }

  async deleteSkill({ name, scope = 'global', enabled = true, cwd } = {}) {
    const safeName = validateSkillName(name);
    const locations = skillDirectories(this.homeDir, scope, cwd);
    const directory = enabled ? locations.active : locations.managed;
    const target = skillPath(directory, safeName);
    if (!existsSync(target)) return { success: false, error: `Skill does not exist: ${safeName}` };
    await fs.rm(target, { recursive: true, force: true });
    return { success: true, name: safeName, scope, enabled };
  }

  async toggleSkill({ name, scope = 'global', enabled = true, cwd } = {}) {
    const safeName = validateSkillName(name);
    if (typeof enabled !== 'boolean') throw new Error('Skill enabled state must be boolean');
    const locations = skillDirectories(this.homeDir, scope, cwd);
    const sourceDirectory = enabled ? locations.active : locations.managed;
    const targetDirectory = enabled ? locations.managed : locations.active;
    const source = skillPath(sourceDirectory, safeName);
    const target = skillPath(targetDirectory, safeName);
    if (!existsSync(source)) {
      return { success: false, error: `Skill does not exist in the ${enabled ? 'active' : 'management'} directory: ${safeName}` };
    }
    if (existsSync(target)) {
      return { success: false, conflict: true, error: `A Skill with the same name already exists at the target: ${safeName}` };
    }
    await fs.mkdir(targetDirectory, { recursive: true });
    await moveDirectory(source, target);
    return { success: true, name: safeName, scope, enabled: !enabled, path: target };
  }

  async openSkill({ skillPath, cwd } = {}) {
    if (typeof skillPath !== 'string' || !skillPath.trim()) throw new Error('Skill path is required');
    const requested = path.resolve(skillPath);
    const locations = [
      skillDirectories(this.homeDir, 'global', cwd),
      skillDirectories(this.homeDir, 'local', cwd),
    ];
    const allowed = locations.some(({ active, managed }) => pathInside(path.resolve(active), requested) || pathInside(path.resolve(managed), requested));
    if (!allowed) throw new Error('Skill path is outside Claude Skill directories');
    if (!existsSync(requested)) throw new Error('Skill path does not exist');
    const stat = await fs.stat(requested);
    let target = requested;
    if (stat.isDirectory()) {
      const candidate = ['SKILL.md', 'skill.md'].find(name => existsSync(path.join(requested, name)));
      if (candidate) target = path.join(requested, candidate);
    }
    return { success: true, path: target };
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
