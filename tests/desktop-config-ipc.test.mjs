import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (filePath) => readFileSync(new URL(filePath, root), 'utf8');

test('desktop main and preload expose local config and completion IPC', () => {
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');

  assert.match(main, /LocalConfigService/);
  assert.match(main, /ipcMain\.handle\('desktop:get-providers'/);
  assert.match(main, /ipcMain\.handle\('desktop:switch-provider'/);
  assert.doesNotMatch(main, /desktop:add-provider|desktop:update-provider|desktop:delete-provider/);
  assert.match(main, /ipcMain\.handle\('desktop:get-agents'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-agent'/);
  assert.match(main, /ipcMain\.handle\('desktop:save-agent'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-agent'/);
  assert.match(main, /ipcMain\.handle\('desktop:set-selected-agent'/);
  assert.match(main, /ipcMain\.handle\('desktop:export-agents'/);
  assert.match(main, /ipcMain\.handle\('desktop:import-agents'/);
  assert.match(main, /ipcMain\.handle\('desktop:save-mcp-server'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-mcp-server'/);
  assert.match(main, /ipcMain\.handle\('desktop:toggle-mcp-server'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-mcp-status'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-mcp-tools'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-mcp-server-for-edit'/);
  assert.match(main, /ipcMain\.handle\('desktop:import-skills'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-skill'/);
  assert.match(main, /ipcMain\.handle\('desktop:toggle-skill'/);
  assert.match(main, /ipcMain\.handle\('desktop:open-skill'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-commands'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-prompts'/);
  assert.match(main, /ipcMain\.handle\('desktop:save-prompt'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-prompt'/);
  assert.match(main, /ipcMain\.handle\('desktop:scan-files'/);

  assert.match(preload, /getProviders:/);
  assert.match(preload, /switchProvider:/);
  assert.doesNotMatch(preload, /addProvider:|updateProvider:|deleteProvider:/);
  assert.match(preload, /getAgents:/);
  assert.match(preload, /getAgent:/);
  assert.match(preload, /saveAgent:/);
  assert.match(preload, /deleteAgent:/);
  assert.match(preload, /setSelectedAgent:/);
  assert.match(preload, /exportAgents:/);
  assert.match(preload, /importAgents:/);
  assert.match(preload, /saveMcpServer:/);
  assert.match(preload, /deleteMcpServer:/);
  assert.match(preload, /toggleMcpServer:/);
  assert.match(preload, /getMcpStatus:/);
  assert.match(preload, /getMcpTools:/);
  assert.match(preload, /getMcpServerForEdit:/);
  assert.match(preload, /importSkills:/);
  assert.match(preload, /deleteSkill:/);
  assert.match(preload, /toggleSkill:/);
  assert.match(preload, /openSkill:/);
  assert.match(preload, /getCommands:/);
  assert.match(preload, /getPrompts:/);
  assert.match(preload, /savePrompt:/);
  assert.match(preload, /deletePrompt:/);
  assert.match(preload, /scanFiles:/);
});

test('client data api uses desktop IPC without broker fetch fallback', () => {
  const api = read('src/utils/desktopBridgeApi.ts');

  assert.match(api, /requireDesktopApi\(\)\.getProviders/);
  assert.match(api, /requireDesktopApi\(\)\.switchProvider/);
  assert.doesNotMatch(api, /requireDesktopApi\(\)\.(addProvider|updateProvider|deleteProvider)/);
  assert.match(api, /requireDesktopApi\(\)\.getAgents/);
  assert.match(api, /requireDesktopApi\(\)\.saveAgent/);
  assert.match(api, /requireDesktopApi\(\)\.deleteAgent/);
  assert.match(api, /requireDesktopApi\(\)\.setSelectedAgent/);
  assert.match(api, /requireDesktopApi\(\)\.exportAgents/);
  assert.match(api, /requireDesktopApi\(\)\.importAgents/);
  assert.match(api, /requireDesktopApi\(\)\.saveMcpServer/);
  assert.match(api, /requireDesktopApi\(\)\.deleteMcpServer/);
  assert.match(api, /requireDesktopApi\(\)\.toggleMcpServer/);
  assert.match(api, /requireDesktopApi\(\)\.getMcpStatus/);
  assert.match(api, /requireDesktopApi\(\)\.getMcpTools/);
  assert.match(api, /requireDesktopApi\(\)\.getMcpServerForEdit/);
  assert.match(api, /requireDesktopApi\(\)\.importSkills/);
  assert.match(api, /requireDesktopApi\(\)\.deleteSkill/);
  assert.match(api, /requireDesktopApi\(\)\.toggleSkill/);
  assert.match(api, /requireDesktopApi\(\)\.openSkill/);
  assert.match(api, /requireDesktopApi\(\)\.getCommands/);
  assert.match(api, /requireDesktopApi\(\)\.getPrompts/);
  assert.match(api, /requireDesktopApi\(\)\.savePrompt/);
  assert.match(api, /requireDesktopApi\(\)\.deletePrompt/);
  assert.match(api, /requireDesktopApi\(\)\.scanFiles/);
  assert.doesNotMatch(api, /fetch\(/);
});

test('desktop local config service mirrors existing Claude-side readers without touching the real home', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-local-config-'));

  try {
    await mkdir(path.join(homeDir, '.claude', 'agents'), { recursive: true });
    await mkdir(path.join(homeDir, '.claude', 'commands'), { recursive: true });
    await mkdir(path.join(homeDir, '.claude', 'prompts'), { recursive: true });
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ env: { CC_SWITCH_PROVIDER_ID: 'provider-a', ANTHROPIC_DEFAULT_SONNET_MODEL: 'mapped-sonnet' } }),
      'utf8',
    );
    await writeFile(path.join(homeDir, '.claude', 'agents', 'writer.md'), 'description: Writes files\n\nBody', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship it\nargs: --dry-run\n---\n', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'prompts', 'tone.md'), 'Use a calm tone.', 'utf8');

    const service = new LocalConfigService({ homeDir });

    const providers = await service.getProviders();
    assert.deepEqual(providers.currentEnv, {
      CC_SWITCH_PROVIDER_ID: 'provider-a',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'mapped-sonnet',
    });

    const agents = await service.listAgents();
    assert.equal(agents.agents[0].name, 'writer');
    assert.equal(agents.agents[0].description, 'Writes files');

    const commands = await service.listCommands();
    assert.ok(commands.commands.some(command => command.name === 'help' && command.source === 'built-in'));
    assert.ok(commands.commands.some(command => command.name === 'ship' && command.description === 'Ship it' && command.args === '--dry-run'));

    const prompts = await service.listPrompts();
    assert.equal(prompts.prompts[0].name, 'tone');
    assert.equal(prompts.prompts[0].content, 'Use a calm tone.');

    await service.savePrompt({ name: 'new-prompt', content: 'Saved through IPC.' });
    assert.ok((await service.listPrompts()).prompts.some(prompt => prompt.name === 'new-prompt'));
    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(
      path.join(homeDir, '.claude', 'prompts', 'tone.md'),
      'utf8',
    )), 'Use a calm tone.');
    assert.ok((await import('node:fs/promises').then(({ readFile }) => readFile(
      path.join(homeDir, '.ccnexus', 'prompts', 'new-prompt.md'),
      'utf8',
    ))).includes('Saved through IPC.'));
    await service.deletePrompt('new-prompt');
    assert.ok(!(await service.listPrompts()).prompts.some(prompt => prompt.name === 'new-prompt'));
    await assert.rejects(() => service.savePrompt({ name: '../bad', content: 'nope' }), /Invalid prompt name/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('ccNexus managed agents support isolated CRUD and preserve native Claude agents', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-agent-store-'));
  const projectCwd = path.join(homeDir, 'project');
  const nativeDir = path.join(projectCwd, '.claude', 'agents');
  const nativeFile = path.join(nativeDir, 'native.md');
  const agentConfigPath = path.join(homeDir, '.ccnexus', 'agent.json');

  try {
    await mkdir(nativeDir, { recursive: true });
    await writeFile(nativeFile, '---\ndescription: Native agent\n---\nNative body', 'utf8');

    const service = new LocalConfigService({ homeDir });
    const initial = await service.listAgents(projectCwd);
    assert.equal(initial.selectedAgentId, null);
    assert.deepEqual(initial.agents.map(({ id, name, source, editable, description }) => ({
      id, name, source, editable, description,
    })), [{
      id: 'native',
      name: 'native',
      source: 'claude',
      editable: false,
      description: 'Native agent',
    }]);

    const saved = await service.saveAgent({ id: 'writer', name: 'Writer', prompt: 'Write carefully.' });
    assert.equal(saved.success, true);
    assert.equal(saved.agent.source, 'ccnexus');
    assert.equal(saved.agent.editable, true);
    assert.equal((await service.getAgent('writer', projectCwd)).content, 'Write carefully.');

    const config = JSON.parse(await readFile(agentConfigPath, 'utf8'));
    assert.equal(config.version, 1);
    assert.equal(config.agents.writer.name, 'Writer');
    assert.equal(config.agents.writer.prompt, 'Write carefully.');

    await service.setSelectedAgent('writer');
    assert.equal((await service.listAgents(projectCwd)).selectedAgentId, 'writer');
    await service.saveAgent({ id: 'writer', name: 'Writer 2', prompt: 'Updated.' });
    assert.equal((await service.getAgent('writer', projectCwd)).content, 'Updated.');

    await service.deleteAgent('writer');
    assert.equal((await service.listAgents(projectCwd)).selectedAgentId, null);
    assert.equal(await readFile(nativeFile, 'utf8'), '---\ndescription: Native agent\n---\nNative body');
    await assert.rejects(
      () => service.saveAgent({ id: '../outside', name: 'Outside', prompt: 'Nope.' }),
      /Invalid agent id/,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('ccNexus managed agent imports apply skip, overwrite, and duplicate strategies', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-agent-import-'));

  try {
    const service = new LocalConfigService({ homeDir });
    await service.saveAgent({ id: 'writer', name: 'Writer', prompt: 'Original.' });

    await service.importAgents({
      strategy: 'skip',
      agents: [
        { id: 'writer', name: 'Skipped Writer', prompt: 'Skipped.' },
        { id: 'reviewer', name: 'Reviewer', prompt: 'Review.' },
      ],
    });
    assert.equal((await service.getAgent('writer')).content, 'Original.');
    assert.equal((await service.getAgent('reviewer')).content, 'Review.');

    await service.importAgents({
      strategy: 'overwrite',
      agents: [{ id: 'writer', name: 'Updated Writer', prompt: 'Overwritten.' }],
    });
    assert.equal((await service.getAgent('writer')).content, 'Overwritten.');

    await service.importAgents({
      strategy: 'duplicate',
      agents: [{ id: 'writer', name: 'Duplicate Writer', prompt: 'Duplicated.' }],
    });
    const exported = await service.exportAgents();
    assert.equal(exported.version, 1);
    assert.ok(Object.values(exported.agents).some(agent => agent.prompt === 'Duplicated.'));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('Claude config write helpers preserve unrelated fields and sync only MCP fields', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-claude-config-write-'));
  const claudeJsonPath = path.join(homeDir, '.claude.json');
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(claudeJsonPath, JSON.stringify({
      customState: { keep: true },
      mcpServers: { existing: { command: 'node', args: ['existing.mjs'] } },
      disabledMcpServers: ['old-disabled'],
    }), 'utf8');
    await writeFile(settingsPath, JSON.stringify({
      env: { ANTHROPIC_MODEL: 'keep-model' },
      hooks: { keep: true },
    }), 'utf8');

    const service = new LocalConfigService({ homeDir });
    await service.updateClaudeJson(config => {
      config.mcpServers.added = { command: 'node', args: ['added.mjs'] };
      config.disabledMcpServers = ['added-disabled'];
      return config;
    });

    const updatedClaudeJson = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
    assert.deepEqual(updatedClaudeJson.customState, { keep: true });
    assert.deepEqual(updatedClaudeJson.mcpServers.added, { command: 'node', args: ['added.mjs'] });
    assert.deepEqual(updatedClaudeJson.disabledMcpServers, ['added-disabled']);

    await service.syncMcpToClaudeSettings();
    const updatedSettings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(updatedSettings.env, { ANTHROPIC_MODEL: 'keep-model' });
    assert.deepEqual(updatedSettings.hooks, { keep: true });
    assert.deepEqual(updatedSettings.mcpServers, updatedClaudeJson.mcpServers);
    assert.deepEqual(updatedSettings.disabledMcpServers, ['added-disabled']);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop provider modes ignore external and ccNexus provider records', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-provider-mode-isolation-'));

  try {
    await mkdir(path.join(homeDir, '.cc-switch'), { recursive: true });
    await mkdir(path.join(homeDir, '.codemoss'), { recursive: true });
    await mkdir(path.join(homeDir, '.ccnexus'), { recursive: true });
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.cc-switch', 'cc-switch.db'), 'external provider database', 'utf8');
    await writeFile(
      path.join(homeDir, '.codemoss', 'config.json'),
      JSON.stringify({ claude: { current: 'codemoss-provider', providers: {
        'codemoss-provider': { name: 'codemoss provider', settingsConfig: { env: { ANTHROPIC_MODEL: 'external-model' } } },
      } } }),
      'utf8',
    );
    await writeFile(
      path.join(homeDir, '.ccnexus', 'providers.json'),
      JSON.stringify([{ id: 'ccnexus-provider', name: 'ccNexus provider' }]),
      'utf8',
    );
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_MODEL: 'local-model' } }), 'utf8');

    const service = new LocalConfigService({ homeDir });
    const providers = await service.getProviders();

    assert.deepEqual(providers.providers.map(provider => provider.id), [
      '__local_settings_json__',
      '__cli_login__',
    ]);
    assert.equal(providers.currentProviderId, '__local_settings_json__');
    await assert.rejects(() => service.switchProvider('codemoss-provider'), /Provider not found/);
    await assert.rejects(() => service.switchProvider('ccnexus-provider'), /Provider not found/);
    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(settingsPath, 'utf8')), JSON.stringify({ env: { ANTHROPIC_MODEL: 'local-model' } }));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop local config exposes merged Claude MCP and Skills state', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-mcp-skills-state-'));
  const cwd = path.join(homeDir, 'workspace');
  const claudeJsonPath = path.join(homeDir, '.claude.json');
  const claudeJson = {
    mcpServers: {
      globalDocs: { command: 'node', args: ['global-docs.mjs'] },
      disabledGlobal: { command: 'node', args: ['disabled.mjs'] },
    },
    disabledMcpServers: ['disabledGlobal'],
    projects: {
      [cwd]: {
        mcpServers: {
          projectDocs: { command: 'node', args: ['project-docs.mjs'] },
        },
      },
    },
  };

  try {
    await mkdir(path.join(homeDir, '.claude', 'skills', 'reviewer'), { recursive: true });
    await mkdir(path.join(cwd, '.claude', 'skills', 'local-check'), { recursive: true });
    await writeFile(claudeJsonPath, JSON.stringify(claudeJson), 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'skills', 'reviewer', 'SKILL.md'),
      '---\nname: reviewer\ndescription: Review changes\n---\nUse review mode.',
      'utf8',
    );
    await writeFile(
      path.join(cwd, '.claude', 'skills', 'local-check', 'skill.md'),
      '---\nname: local-check\ndescription: Check local files\n---\nCheck files.',
      'utf8',
    );

    const service = new LocalConfigService({ homeDir });
    const before = readFileSync(claudeJsonPath, 'utf8');
    const mcp = await service.listMcpServers(cwd);
    const runtimeMcp = await service.getMcpServerRuntimeSnapshot(cwd);
    const editable = await service.getMcpServerForEdit({ id: 'globalDocs', scope: 'global', cwd });
    const skills = await service.listSkills(cwd);

    assert.deepEqual(mcp.servers.map(server => server.id), ['globalDocs', 'projectDocs']);
    assert.deepEqual(mcp.disabled, [{ id: 'disabledGlobal', scope: 'global', reason: 'Server is disabled' }]);
    assert.deepEqual(runtimeMcp.servers.map(server => server.id), ['globalDocs', 'projectDocs']);
    assert.deepEqual(runtimeMcp.disabled, mcp.disabled);
    assert.equal(editable.config.command, 'node');
    assert.equal(skills.global.reviewer.description, 'Review changes');
    assert.equal(skills.local['local-check'].description, 'Check local files');
    assert.equal(readFileSync(claudeJsonPath, 'utf8'), before);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('Claude MCP management writes only the requested scope and refreshes settings', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-mcp-management-'));
  const cwd = path.join(homeDir, 'workspace');
  const claudeJsonPath = path.join(homeDir, '.claude.json');
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(claudeJsonPath, JSON.stringify({
      unrelated: { keep: true },
      mcpServers: { shared: { command: 'node', args: ['global.mjs'] } },
      projects: {
        [cwd]: {
          unrelatedProject: 'keep',
          mcpServers: {},
          disabledMcpServers: [],
        },
      },
    }), 'utf8');
    await writeFile(settingsPath, JSON.stringify({ env: { KEEP: 'yes' } }), 'utf8');

    const service = new LocalConfigService({ homeDir });
    await service.saveMcpServer({
      id: 'global-tool',
      config: { command: 'node', args: ['global-tool.mjs'] },
      scope: 'global',
      cwd,
    });
    await service.saveMcpServer({
      id: 'project-tool',
      config: { command: 'node', args: ['project-tool.mjs'] },
      scope: 'project',
      cwd,
    });

    let config = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
    assert.deepEqual(config.unrelated, { keep: true });
    assert.deepEqual(config.projects[cwd].unrelatedProject, 'keep');
    assert.deepEqual(config.mcpServers['global-tool'], { command: 'node', args: ['global-tool.mjs'] });
    assert.deepEqual(config.projects[cwd].mcpServers['project-tool'], { command: 'node', args: ['project-tool.mjs'] });

    await service.toggleMcpServer({ id: 'project-tool', enabled: false, scope: 'project', cwd });
    let state = await service.listMcpServers(cwd);
    assert.ok(state.disabled.some(item => item.id === 'project-tool' && item.scope === 'project'));

    await service.toggleMcpServer({ id: 'project-tool', enabled: true, scope: 'project', cwd });
    state = await service.listMcpServers(cwd);
    assert.ok(state.servers.some(server => server.id === 'project-tool'));

    await service.deleteMcpServer({ id: 'project-tool', scope: 'project', cwd });
    config = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
    assert.equal(config.projects[cwd].mcpServers['project-tool'], undefined);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).env, { KEEP: 'yes' });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop provider service has no external provider-store integration', () => {
  const serviceSource = read('desktop/runtime/localConfigService.js');

  assert.doesNotMatch(serviceSource, /cc-switch\.db|readCcSwitchProviders|sql\.js/);
  assert.doesNotMatch(serviceSource, /codemossConfigPath|readCodemossConfig|getCodemoss/);
  assert.doesNotMatch(serviceSource, /ccnexusProvidersPath|readCcnexusProviders|writeCcnexusProviders/);
  assert.doesNotMatch(serviceSource, /readManagedProviders/);
});

test('desktop main owns provider and prompt operations through LocalConfigService', () => {
  const mainSource = read('desktop/main.js');

  assert.match(mainSource, /localConfig\.getProviders\(\)/);
  assert.match(mainSource, /localConfig\.switchProvider\(args\.providerId\)/);
  assert.match(mainSource, /localConfig\.listPrompts\(\)/);
  assert.match(mainSource, /localConfig\.savePrompt\(args\)/);
  assert.match(mainSource, /localConfig\.deletePrompt\(args\.name\)/);
});

test('provider switching never writes Claude Code settings', () => {
  const serviceSource = read('desktop/runtime/localConfigService.js');

  assert.doesNotMatch(serviceSource, /writeClaudeSettings/);
  assert.match(serviceSource, /provider-state\.json/);
});

test('provider switching resets the persistent runtime before the next query', () => {
  const controllerSource = read('desktop/runtime/chatController.js');
  const mainSource = read('desktop/main.js');

  assert.match(controllerSource, /function resetForProviderChange\(\)/);
  assert.match(controllerSource, /runtime\.shutdown\(\)/);
  assert.match(mainSource, /chatController\.resetForProviderChange\(\)/);
});

test('provider switching persists only the selected ccgui runtime mode', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-provider-state-'));

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const originalSettings = JSON.stringify({ env: { ANTHROPIC_MODEL: 'original' } });
    await writeFile(settingsPath, originalSettings, 'utf8');

    const service = new LocalConfigService({ homeDir });
    await service.switchProvider('__cli_login__');

    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(settingsPath, 'utf8')), originalSettings);
    const providers = await service.getProviders();
    assert.equal(providers.currentProviderId, '__cli_login__');
    assert.deepEqual(providers.providers.map(provider => provider.id), [
      '__local_settings_json__',
      '__cli_login__',
    ]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop provider menu exposes ccgui special runtime modes without writing Claude settings', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-special-provider-'));

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const originalSettings = JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'local-token',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'local-sonnet',
      },
    });
    await writeFile(settingsPath, originalSettings, 'utf8');

    const service = new LocalConfigService({ homeDir });
    const initial = await service.getProviders();
    assert.deepEqual(initial.providers.slice(0, 2).map(provider => provider.id), [
      '__local_settings_json__',
      '__cli_login__',
    ]);
    assert.equal(initial.currentProviderId, '__local_settings_json__');
    assert.equal(initial.providers.find(provider => provider.id === '__local_settings_json__').isActive, true);

    await service.switchProvider('__cli_login__');
    const cli = await service.getProviders();
    assert.equal(cli.currentProviderId, '__cli_login__');
    assert.equal(cli.providers.find(provider => provider.id === '__cli_login__').isActive, true);
    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(settingsPath, 'utf8')), originalSettings);

    const providerState = JSON.parse(await import('node:fs/promises').then(({ readFile }) => (
      readFile(path.join(homeDir, '.ccnexus', 'provider-state.json'), 'utf8')
    )));
    assert.equal(providerState.providerId, '__cli_login__');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test.skip('obsolete provider CRUD contract (ccgui exposes runtime modes only)', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-provider-crud-'));

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const originalSettings = JSON.stringify({ env: { ANTHROPIC_MODEL: 'local-model' } });
    await writeFile(settingsPath, originalSettings, 'utf8');

    const service = new LocalConfigService({ homeDir });
    const created = await service.addProvider({
      name: '团队网关',
      remark: '本地测试供应商',
      api_key: 'secret-token',
      base_url: 'https://gateway.example.test/anthropic',
      model_mapping: { sonnet: 'team-sonnet', opus: 'team-opus' },
    });

    assert.equal(created.source, 'ccnexus');
    assert.equal(created.name, '团队网关');
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal((await service.getProviders()).providers.find(provider => provider.id === created.id).source, 'ccnexus');
    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(settingsPath, 'utf8')), originalSettings);
    assert.ok(await import('node:fs/promises').then(({ readFile }) => readFile(
      path.join(homeDir, '.ccnexus', 'providers.json'),
      'utf8',
    )));

    const updated = await service.updateProvider(created.id, {
      name: '团队网关（更新）',
      remark: '已更新',
      api_key: 'updated-token',
      base_url: 'https://gateway.example.test/v2',
      model_mapping: { sonnet: 'updated-sonnet' },
    });
    assert.equal(updated.name, '团队网关（更新）');
    assert.equal(updated.settingsConfig.env.ANTHROPIC_MODEL, undefined);
    assert.equal(updated.model_mapping.sonnet, 'updated-sonnet');

    await assert.rejects(
      () => service.addProvider({ name: '团队网关（更新）', api_key: 'another-token' }),
      /already exists/i,
    );
    await assert.rejects(
      () => service.updateProvider('__cli_login__', { name: '不能修改' }),
      /special provider/i,
    );
    await assert.rejects(
      () => service.deleteProvider('__local_settings_json__'),
      /special provider/i,
    );

    await service.switchProvider(created.id);
    const deletion = await service.deleteProvider(created.id);
    assert.equal(deletion.ok, true);
    assert.equal(deletion.fallbackProviderId, '__local_settings_json__');
    assert.equal((await service.getProviders()).currentProviderId, '__local_settings_json__');
    assert.equal(await import('node:fs/promises').then(({ readFile }) => readFile(settingsPath, 'utf8')), originalSettings);
    await assert.rejects(
      () => import('node:fs/promises').then(({ readFile }) => readFile(path.join(homeDir, '.ccnexus', 'providers.json'), 'utf8')),
      /ENOENT|no such file/i,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('provider management UI exposes only the two Claude runtime modes', () => {
  const uiSource = read('src/components/settings/ProviderManageSection.tsx');

  assert.match(uiSource, /__local_settings_json__/);
  assert.match(uiSource, /__cli_login__/);
  assert.match(uiSource, /switchProvider/);
  assert.doesNotMatch(uiSource, /addProvider|updateProvider|deleteProvider|regularProviders|ProviderDialog/);
  assert.doesNotMatch(uiSource, /setDialogOpen|setEditingProviderId|ProviderDialog/);
  assert.doesNotMatch(uiSource, /deleteConfirm|handleDelete/);
  assert.doesNotMatch(uiSource, /PROVIDER_PRESETS|智谱|Kimi|DeepSeek|MiniMax|OpenRouter/);
});

test('provider locale files contain the two Claude runtime mode vocabulary', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  for (const key of ['title', 'desc', 'localSettings', 'localSettingsDesc', 'cliLogin', 'cliLoginDesc', 'use', 'authorize', 'current']) {
    assert.equal(typeof zh.settings.providers[key], 'string', `missing zh provider key: ${key}`);
    assert.equal(typeof en.settings.providers[key], 'string', `missing en provider key: ${key}`);
  }
});

test('CLI login runtime environment disables host-managed credentials without changing settings', async () => {
  const { buildClaudeQueryOptions } = await import('../server/queryOptions.js');
  const options = buildClaudeQueryOptions({
    cwd: 'C:\\workspace',
    providerMode: '__cli_login__',
    env: {
      ANTHROPIC_API_KEY: 'stale-api-key',
      ANTHROPIC_AUTH_TOKEN: 'stale-auth-token',
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    },
    clientOptions: { model: 'claude-sonnet-4-6' },
  });

  assert.equal(options.env.ANTHROPIC_API_KEY, '');
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(options.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, undefined);
  assert.equal(options.env.CLAUDE_CODE_ENTRYPOINT, 'cli');
});

test('provider switch UI follows ccgui runtime lifecycle instead of reloading the renderer', () => {
  const source = read('src/components/ConfigSelect.tsx');
  assert.match(source, /isLocalProvider/);
  assert.match(source, /isCliLoginProvider/);
  assert.doesNotMatch(source, /window\.location\.reload\(\)/);
  assert.match(source, /onProviderSwitch/);
});

test('desktop workspace file service scans files for completion through the same workspace root', async () => {
  const { WorkspaceFileService } = await import('../desktop/runtime/workspaceFiles.js');
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-workspace-scan-'));

  try {
    await mkdir(path.join(workspace, 'src'), { recursive: true });
    await writeFile(path.join(workspace, 'src', 'chat.tsx'), 'export {}', 'utf8');
    await writeFile(path.join(workspace, 'README.md'), '# test', 'utf8');

    const service = new WorkspaceFileService({ cwd: workspace });
    const result = await service.scanFiles({ q: 'chat', limit: 20 });

    assert.deepEqual(result.files, ['src/chat.tsx']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
