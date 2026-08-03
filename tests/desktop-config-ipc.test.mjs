import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  assert.match(main, /ipcMain\.handle\('desktop:get-agents'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-agent'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-commands'/);
  assert.match(main, /ipcMain\.handle\('desktop:get-prompts'/);
  assert.match(main, /ipcMain\.handle\('desktop:save-prompt'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-prompt'/);
  assert.match(main, /ipcMain\.handle\('desktop:scan-files'/);

  assert.match(preload, /getProviders:/);
  assert.match(preload, /switchProvider:/);
  assert.match(preload, /getAgents:/);
  assert.match(preload, /getAgent:/);
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
  assert.match(api, /requireDesktopApi\(\)\.getAgents/);
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
    await service.deletePrompt('new-prompt');
    assert.ok(!(await service.listPrompts()).prompts.some(prompt => prompt.name === 'new-prompt'));
    await assert.rejects(() => service.savePrompt({ name: '../bad', content: 'nope' }), /Invalid prompt name/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop local config reads ccgui codemoss provider state for model mapping', async () => {
  const { LocalConfigService } = await import('../desktop/runtime/localConfigService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-codemoss-config-'));

  try {
    await mkdir(path.join(homeDir, '.codemoss'), { recursive: true });
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(
      path.join(homeDir, '.codemoss', 'config.json'),
      JSON.stringify({
        claude: {
          current: 'deepseek-provider',
          providers: {
            'deepseek-provider': {
              name: 'DeepSeek',
              settingsConfig: {
                env: {
                  ANTHROPIC_MODEL: 'deepseek-v4-pro[1M]',
                  ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1M]',
                  ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1M]',
                  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
                },
              },
            },
          },
        },
      }),
      'utf8',
    );
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'stale-sonnet' } }),
      'utf8',
    );

    const service = new LocalConfigService({ homeDir });
    const providers = await service.getProviders();

    assert.equal(providers.currentProviderId, 'deepseek-provider');
    assert.equal(providers.providers[0].id, 'deepseek-provider');
    assert.equal(providers.currentEnv.ANTHROPIC_MODEL, 'deepseek-v4-pro[1M]');
    assert.equal(providers.currentEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4-flash');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop local config follows ccgui cc-switch database filename and settings_config shape', () => {
  const serviceSource = read('desktop/runtime/localConfigService.js');

  assert.match(serviceSource, /cc-switch\.db/);
  assert.doesNotMatch(serviceSource, /data\.db/);
  assert.match(serviceSource, /settings_config/);
});

test('desktop main owns provider and prompt operations through LocalConfigService', () => {
  const mainSource = read('desktop/main.js');

  assert.match(mainSource, /localConfig\.getProviders\(\)/);
  assert.match(mainSource, /localConfig\.switchProvider\(args\.providerId\)/);
  assert.match(mainSource, /localConfig\.listPrompts\(\)/);
  assert.match(mainSource, /localConfig\.savePrompt\(args\)/);
  assert.match(mainSource, /localConfig\.deletePrompt\(args\.name\)/);
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
