import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildClaudeQueryOptions, buildPromptEnhancementQueryOptions } from '../server/queryOptions.js';
import { buildClaudeClientOptions } from '../server/claudeRequestContext.js';

test('packaged Windows query points the SDK at the unpacked Claude binary', () => {
  const resourcesPath = 'C:\\Program Files\\ccNexus\\resources';
  const expected = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk-win32-x64',
    'claude.exe',
  );

  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    clientOptions: {},
    resourcesPath,
    platform: 'win32',
    arch: 'x64',
    fileExists: filePath => filePath === expected,
  });

  assert.equal(options.pathToClaudeCodeExecutable, expected);
});

test('builds ccgui-style SDK options from client dialogue controls', () => {
  const canUseTool = async () => ({ behavior: 'allow' });
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: { EXISTING: '1' },
    canUseTool,
    clientOptions: {
      mode: 'bypassPermissions',
      model: 'claude-sonnet-5',
      streaming: true,
      reasoning: 'xhigh',
      alwaysThinking: true,
    },
  });

  assert.equal(options.cwd, 'D:/repo');
  assert.equal(options.permissionMode, 'bypassPermissions');
  assert.equal(options.model, 'sonnet');
  assert.equal(options.maxTurns, 100);
  assert.equal(options.enableFileCheckpointing, true);
  assert.equal(options.includePartialMessages, true);
  assert.equal(options.allowDangerouslySkipPermissions, true);
  assert.deepEqual(options.settingSources, ['user', 'project', 'local']);
  assert.equal(Object.hasOwn(options, 'thinking'), false);
  assert.equal(Object.hasOwn(options, 'maxThinkingTokens'), false);
  assert.equal(options.effort, 'xhigh');
  assert.equal(options.env.EXISTING, '1');
  assert.equal(options.canUseTool, canUseTool);
});

test('auto is a valid SDK permission mode without dangerous bypass', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: { mode: 'auto' },
  });

  assert.equal(options.permissionMode, 'auto');
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
});

test('bypassPermissions remains the only dangerous launch mode', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: { mode: 'bypassPermissions' },
  });

  assert.equal(options.permissionMode, 'bypassPermissions');
  assert.equal(options.allowDangerouslySkipPermissions, true);
});

test('omits default model and disables partial messages when streaming is false', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      mode: 'default',
      model: 'default',
      streaming: false,
      reasoning: 'not-real',
      alwaysThinking: true,
    },
  });

  assert.equal(options.permissionMode, 'default');
  assert.equal('model' in options, false);
  assert.equal(options.includePartialMessages, false);
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.equal(options.effort, undefined);
  assert.equal(options.maxThinkingTokens, 10000);
});

test('does not send reasoning effort when the thinking toggle is off', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6[1m]',
      reasoning: 'high',
      alwaysThinking: false,
    },
  });

  assert.equal(Object.hasOwn(options, 'effort'), false);
  assert.equal(Object.hasOwn(options, 'maxThinkingTokens'), false);
});

test('preserves ccgui long context marker before passing model to SDK', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-opus-4-8[1m]',
    },
  });

  assert.equal(options.model, 'opus');
});

test('resolves ccgui provider model mapping before passing model to SDK', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'GLM-4.6-W8A8',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'Qwen3-Next-80B-A3B-Thinking',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7-bf16',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6[1m]',
    },
  });

  assert.equal(options.model, 'sonnet');
  assert.equal(options.env.ANTHROPIC_MODEL, 'GLM-4.6-W8A8[1m]');
});

test('strips stale provider mapping suffix when the 1M toggle is off', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1M]',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6',
    },
  });

  assert.equal(options.model, 'sonnet');
  assert.equal(options.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
});

test('role-specific provider mapping beats the default fallback model', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1M]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-haiku-4-5',
    },
  });

  assert.equal(options.model, 'haiku');
  assert.equal(options.env.ANTHROPIC_MODEL, 'deepseek-v4-flash');
});

test('Fable follows ccgui main model fallback instead of a private fable mapping', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1M]',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'wrong-fable-only',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-fable-5',
    },
  });

  assert.equal(options.model, 'sonnet');
  assert.equal(options.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
});

test('includes ccgui cache-critical Claude Code preset and settings override', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      EXISTING: '1',
      CLAUDE_CODE_DISABLE_1M_CONTEXT: 'stale',
      MAX_THINKING_TOKENS: 'stale',
      CLAUDE_AGENT_SDK_VERSION: 'sdk-marker',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6[1m]',
      streaming: true,
    },
  });

  assert.equal(options.systemPrompt.type, 'preset');
  assert.equal(options.systemPrompt.preset, 'claude_code');
  assert.match(options.systemPrompt.append, /File Path Format Requirement/);
  assert.deepEqual(options.settings, {
    env: {
      CLAUDE_CODE_EFFORT_LEVEL: '',
      MAX_THINKING_TOKENS: '',
      CLAUDE_CODE_DISABLE_1M_CONTEXT: '',
    },
  });
  assert.deepEqual(options.additionalDirectories, ['D:/repo']);
  assert.equal(options.env.EXISTING, '1');
  assert.equal(options.env.CLAUDE_CODE_ENTRYPOINT, 'cli');
  assert.equal(options.env.USER_TYPE, 'external');
  assert.equal('CLAUDE_AGENT_SDK_VERSION' in options.env, false);
  assert.equal('CLAUDE_CODE_DISABLE_1M_CONTEXT' in options.env, false);
  assert.equal('MAX_THINKING_TOKENS' in options.env, false);
});

test('disables 1M context through ccgui inline settings when long context is off', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6',
    },
  });

  assert.equal(options.settings.env.CLAUDE_CODE_DISABLE_1M_CONTEXT, '1');
});

test('uses ccgui SDK model selector and request-scoped model routing env', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_MODEL: 'stale-global-model',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'provider-sonnet',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6[1m]',
    },
  });

  assert.equal(options.model, 'sonnet');
  assert.equal(options.env.ANTHROPIC_MODEL, 'provider-sonnet[1m]');
  assert.equal(options.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'provider-sonnet[1m]');
  assert.equal(options.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, '1');
});

test('keeps ccgui cache prefix inputs stable in the SDK options', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {
      IDEA_PROJECT_PATH: 'D:/workspace',
      PROJECT_PATH: 'D:/repo',
    },
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6',
      systemPromptAppend: '\\n\\n## Stable IDE context',
      additionalDirectories: ['D:/repo', 'D:/workspace', 'D:/repo'],
      mcpServers: {
        docs: { command: 'node', args: ['docs-server.mjs'] },
      },
    },
  });

  assert.deepEqual(options.additionalDirectories, ['D:/repo', 'D:/workspace']);
  assert.deepEqual(options.mcpServers, {
    docs: { command: 'node', args: ['docs-server.mjs'] },
  });
  assert.deepEqual(options.systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
    append: '\\n\\n## Stable IDE context',
  });
});

test('includes ccgui agent instructions in the stable system prompt append', () => {
  const options = buildClaudeQueryOptions({
    cwd: 'D:/repo',
    env: {},
    canUseTool: async () => ({ behavior: 'allow' }),
    clientOptions: {
      model: 'claude-sonnet-4-6',
      agentPrompt: 'Review the implementation as a release engineer.',
    },
  });

  assert.match(options.systemPrompt.append, /Agent Role and Instructions/);
  assert.match(options.systemPrompt.append, /release engineer/);
  assert.match(options.systemPrompt.append, /File Path Format Requirement/);
});

test('builds one ccgui-style request context from agent and MCP state', async () => {
  const clientOptions = await buildClaudeClientOptions({
    cwd: 'D:/repo',
    clientOptions: { model: 'claude-sonnet-4-6', agent: 'release-reviewer' },
    loadAgent: async (name) => ({ name, content: 'Review release risks.' }),
    loadMcpServers: async (cwd) => ({ docs: { command: 'node', args: [cwd] } }),
  });

  assert.equal(clientOptions.agentPrompt, 'Review release risks.');
  assert.deepEqual(clientOptions.mcpServers, {
    docs: { command: 'node', args: ['D:/repo'] },
  });
});

test('prompt enhancement options disable project execution surfaces', async () => {
  const options = buildPromptEnhancementQueryOptions({
    cwd: 'D:/repo',
    env: {
      ANTHROPIC_API_KEY: 'test-key',
      PROJECT_PATH: 'D:/other-project',
      IDEA_PROJECT_PATH: 'D:/idea-project',
    },
    providerMode: '',
    model: 'claude-sonnet-4-6',
  });

  assert.equal(options.cwd, 'D:/repo');
  assert.equal(options.model, 'sonnet');
  assert.equal(options.maxTurns, 1);
  assert.equal(options.enableFileCheckpointing, false);
  assert.equal(options.includePartialMessages, false);
  assert.equal(options.permissionMode, 'default');
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.additionalDirectories, []);
  assert.deepEqual(options.tools, []);
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.equal(options.persistSession, false);
  assert.equal(options.strictMcpConfig, true);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.isolatedDenyAllTools, true);
  assert.equal(typeof options.canUseTool, 'function');
  assert.equal(options.env.ANTHROPIC_API_KEY, 'test-key');
  assert.equal(options.env.PROJECT_PATH, 'D:/other-project');
  assert.equal(options.env.IDEA_PROJECT_PATH, 'D:/idea-project');
  assert.match(options.systemPrompt, /no tools/i);
  assert.match(options.systemPrompt, /no explanatory wrapper/i);

  const decision = await options.canUseTool('Read', { file_path: 'D:/repo/file.txt' });
  assert.deepEqual(decision, {
    behavior: 'deny',
    message: 'Prompt enhancement cannot use tools',
  });
});
