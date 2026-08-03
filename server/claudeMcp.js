import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function isValidServerConfig(serverConfig) {
  if (!serverConfig || typeof serverConfig !== 'object') return false;
  const hasCommand = typeof serverConfig.command === 'string' && serverConfig.command.length > 0;
  const hasUrl = typeof serverConfig.url === 'string' && serverConfig.url.length > 0;
  if (!hasCommand && !hasUrl) return false;
  if (serverConfig.args !== undefined && !Array.isArray(serverConfig.args)) return false;
  if (serverConfig.env !== undefined && (!serverConfig.env || typeof serverConfig.env !== 'object')) return false;
  return true;
}

function normalizeCwd(cwd) {
  if (!cwd) return '';
  return String(cwd).replace(/\\/g, '/').replace(/\/$/, '');
}

function findProjectConfig(config, cwd) {
  const normalizedCwd = normalizeCwd(cwd);
  const projects = config?.projects;
  if (!normalizedCwd || !projects || typeof projects !== 'object') return null;
  if (projects[normalizedCwd]) return projects[normalizedCwd];

  const variants = new Set([
    normalizedCwd,
    normalizedCwd.replace(/\//g, '\\'),
    `/${normalizedCwd}`,
  ]);
  for (const [projectPath, projectConfig] of Object.entries(projects)) {
    if (variants.has(projectPath.replace(/\\/g, '/')) || variants.has(projectPath)) {
      return projectConfig;
    }
  }
  return null;
}

export async function loadMcpServersConfigAsRecord(cwd = null, { homeDir = os.homedir() } = {}) {
  const configPath = path.join(homeDir, '.claude.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    if (!config || typeof config !== 'object') return null;

    const projectConfig = findProjectConfig(config, cwd);
    const projectServers = projectConfig?.mcpServers;
    const hasProjectServers = projectServers && typeof projectServers === 'object'
      && Object.keys(projectServers).length > 0;
    const serverConfig = hasProjectServers ? projectServers : (config.mcpServers || {});
    const disabledServers = hasProjectServers
      ? new Set(Array.isArray(projectConfig.disabledMcpServers) ? projectConfig.disabledMcpServers : [])
      : new Set(Array.isArray(config.disabledMcpServers) ? config.disabledMcpServers : []);

    const enabled = Object.entries(serverConfig)
      .filter(([name, value]) => !disabledServers.has(name) && isValidServerConfig(value))
      .map(([name, value]) => [name, value]);
    return enabled.length > 0 ? Object.fromEntries(enabled) : null;
  } catch {
    return null;
  }
}
