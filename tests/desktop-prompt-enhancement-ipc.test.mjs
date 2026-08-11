import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (filePath) => readFileSync(new URL(filePath, root), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function captureBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

function captureFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  let index = source.indexOf('{', start);
  assert.notEqual(index, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated function: ${signature}`);
}

function stripTsFunction(functionSource) {
  return functionSource
    .replace(/export\s+/g, '')
    .replace(/function\s+(\w+)\(([^)]*)\)/g, (_match, name, params) => (
      `function ${name}(${params.replace(/:\s*[^,)=]+/g, '')})`
    ))
    .replace(/\)\s*:\s*[^{]+\{/g, ') {');
}

function loadPromptEnhancementMainHandlers({ enhanceResult, cancelResult }) {
  const main = read('desktop/main.js');
  const snippet = captureBlock(
    main,
    "ipcMain.handle('desktop:enhance-prompt'",
    "ipcMain.handle('desktop:stop-process'",
  );

  const handlers = {};
  const calls = { enhance: [], cancel: [] };
  const ipcMain = {
    handle(channel, handler) {
      handlers[channel] = handler;
    },
  };
  const promptEnhancementService = {
    async enhance(args) {
      calls.enhance.push(args);
      return enhanceResult;
    },
    async cancel(requestId) {
      calls.cancel.push(requestId);
      return cancelResult;
    },
  };

  vm.runInNewContext(snippet, { ipcMain, promptEnhancementService });
  return { handlers, calls };
}

function loadPreloadBridge() {
  const preload = read('desktop/preload.cjs');
  const invocations = [];
  let bridge = null;
  const contextBridge = {
    exposeInMainWorld(_name, api) {
      bridge = api;
    },
  };
  const ipcRenderer = {
    invoke(channel, ...args) {
      invocations.push({ channel, args });
      return Promise.resolve({ channel, args });
    },
    on() {},
    removeListener() {},
    send() {},
  };

  vm.runInNewContext(preload, {
    require(moduleName) {
      assert.equal(moduleName, 'electron');
      return { contextBridge, ipcRenderer };
    },
  });

  assert.ok(bridge, 'preload did not expose a desktop bridge');
  return { bridge, invocations };
}

function loadDesktopBridgePromptEnhancementWrappers(api) {
  const source = read('src/utils/desktopBridgeApi.ts');
  const requireDesktopApiSource = stripTsFunction(captureFunction(source, 'function requireDesktopApi'));
  const enhancePromptSource = stripTsFunction(captureFunction(source, 'export async function enhancePrompt'));
  const cancelPromptEnhancementSource = stripTsFunction(captureFunction(source, 'export async function cancelPromptEnhancement'));

  const script = [
    requireDesktopApiSource,
    enhancePromptSource,
    cancelPromptEnhancementSource,
    'result = { enhancePrompt, cancelPromptEnhancement };',
  ].join('\n');

  const context = {
    window: { ccNexusDesktop: api },
    result: null,
  };
  vm.runInNewContext(script, context);
  return context.result;
}

test('desktop main registers prompt enhancement IPC on the dedicated service', () => {
  const main = read('desktop/main.js');

  assert.match(main, /ipcMain\.handle\('desktop:enhance-prompt'/);
  assert.match(main, /ipcMain\.handle\('desktop:cancel-prompt-enhancement'/);
  assert.match(main, /promptEnhancementService\.enhance\(args\)/);
  assert.match(main, /promptEnhancementService\.cancel\(args\.requestId\)/);
  assert.match(main, /promptEnhancementService\.dispose\(\)/);

  const enhanceStart = main.indexOf("ipcMain.handle('desktop:enhance-prompt'");
  const cancelStart = main.indexOf("ipcMain.handle('desktop:cancel-prompt-enhancement'");
  const stopProcessStart = main.indexOf("ipcMain.handle('desktop:stop-process'");
  assert.notEqual(enhanceStart, -1);
  assert.notEqual(cancelStart, -1);
  assert.notEqual(stopProcessStart, -1);

  const enhanceBlock = main.slice(enhanceStart, cancelStart);
  const cancelBlock = main.slice(cancelStart, stopProcessStart);

  assert.doesNotMatch(enhanceBlock, /chatController\.handle/);
  assert.doesNotMatch(enhanceBlock, /sendChatCommand|desktop:chat-command|restartDaemon|stopProcess|activeSession|getActiveSession|loadSession/);
  assert.doesNotMatch(cancelBlock, /chatController\.handle/);
  assert.doesNotMatch(cancelBlock, /sendChatCommand|desktop:chat-command|restartDaemon|stopProcess|activeSession|getActiveSession|loadSession/);
});

test('preload exposes prompt enhancement methods over the existing desktop bridge', () => {
  const preload = read('desktop/preload.cjs');

  assert.match(preload, /enhancePrompt:\s*\(args\)\s*=>\s*ipcRenderer\.invoke\('desktop:enhance-prompt',\s*args\)/);
  assert.match(preload, /cancelPromptEnhancement:\s*\(requestId\)\s*=>\s*ipcRenderer\.invoke\('desktop:cancel-prompt-enhancement',\s*\{\s*requestId\s*\}\)/);
});

test('renderer bridge helper uses requireDesktopApi for prompt enhancement without fetch fallback', () => {
  const api = read('src/utils/desktopBridgeApi.ts');

  assert.match(api, /function requireDesktopApi\(\): CcNexusDesktopApi/);
  assert.match(api, /export async function enhancePrompt\(args:/);
  assert.match(api, /requireDesktopApi\(\)\.enhancePrompt\(args\)/);
  assert.match(api, /export async function cancelPromptEnhancement\(requestId: string\)/);
  assert.match(api, /requireDesktopApi\(\)\.cancelPromptEnhancement\(requestId\)/);
  assert.doesNotMatch(api, /fetch\(/);
});

test('desktop bridge types expose prompt enhancement argument and result shapes for renderer use', () => {
  const types = read('src/vite-env.d.ts');

  assert.match(types, /interface PromptEnhancementArgs\s*\{/);
  assert.match(types, /requestId:\s*string;/);
  assert.match(types, /text:\s*string;/);
  assert.match(types, /localResult:\s*unknown;/);
  assert.match(types, /interface PromptEnhancementUsage\s*\{/);
  assert.match(types, /input_tokens:\s*number;/);
  assert.match(types, /cache_creation_input_tokens:\s*number;/);
  assert.match(types, /cache_read_input_tokens:\s*number;/);
  assert.match(types, /output_tokens:\s*number;/);
  assert.match(types, /interface PromptEnhancementResult\s*\{/);
  assert.match(types, /requestId:\s*string;/);
  assert.match(types, /text:\s*string;/);
  assert.match(types, /model:\s*string;/);
  assert.match(types, /usage:\s*PromptEnhancementUsage\s*\|\s*undefined;/);
  assert.match(types, /interface PromptEnhancementCancelResult\s*\{/);
  assert.match(types, /cancelled:\s*boolean;/);
  assert.match(types, /getRuntimeInfo:/);
  assert.match(types, /enhancePrompt:\s*\(args:\s*PromptEnhancementArgs\)\s*=>\s*Promise<PromptEnhancementResult>/);
  assert.match(types, /cancelPromptEnhancement:\s*\(requestId:\s*string\)\s*=>\s*Promise<PromptEnhancementCancelResult>/);
});

test('registered enhance handler forwards exact args to promptEnhancementService.enhance and returns its result', async () => {
  const args = { requestId: 'req-1', text: 'Draft', localResult: { files: ['a.md'] } };
  const expected = { requestId: 'req-1', text: 'Enhanced', model: 'claude-sonnet-4-6', usage: { output_tokens: 12 } };
  const { handlers, calls } = loadPromptEnhancementMainHandlers({
    enhanceResult: expected,
    cancelResult: true,
  });

  const result = await handlers['desktop:enhance-prompt']({ sender: {} }, args);

  assert.deepEqual(calls.enhance, [args]);
  assert.deepEqual(result, expected);
});

test('registered cancel handler forwards requestId and returns cancelled plus requestId', async () => {
  const args = { requestId: 'req-cancel' };
  const { handlers, calls } = loadPromptEnhancementMainHandlers({
    enhanceResult: null,
    cancelResult: false,
  });

  const result = await handlers['desktop:cancel-prompt-enhancement']({ sender: {} }, args);

  assert.deepEqual(calls.cancel, ['req-cancel']);
  assert.deepEqual(plain(result), { cancelled: false, requestId: 'req-cancel' });
});

test('preload bridge methods invoke the expected IPC channels and payloads', async () => {
  const { bridge, invocations } = loadPreloadBridge();
  const enhanceArgs = { requestId: 'req-2', text: 'Prompt', localResult: { summary: 'local' } };

  await bridge.enhancePrompt(enhanceArgs);
  await bridge.cancelPromptEnhancement('req-2');

  assert.deepEqual(plain(invocations), [
    { channel: 'desktop:enhance-prompt', args: [enhanceArgs] },
    { channel: 'desktop:cancel-prompt-enhancement', args: [{ requestId: 'req-2' }] },
  ]);
});

test('renderer wrappers call requireDesktopApi and return desktop bridge results', async () => {
  const calls = [];
  const api = {
    enhancePrompt: async (args) => {
      calls.push({ method: 'enhancePrompt', args });
      return { requestId: args.requestId, text: 'Wrapped', model: 'claude-sonnet-4-6', usage: undefined };
    },
    cancelPromptEnhancement: async (requestId) => {
      calls.push({ method: 'cancelPromptEnhancement', args: requestId });
      return { cancelled: true, requestId };
    },
  };
  const wrappers = loadDesktopBridgePromptEnhancementWrappers(api);

  const enhanced = await wrappers.enhancePrompt({ requestId: 'req-3', text: 'x', localResult: { ok: true } });
  const cancelled = await wrappers.cancelPromptEnhancement('req-3');

  assert.deepEqual(calls, [
    { method: 'enhancePrompt', args: { requestId: 'req-3', text: 'x', localResult: { ok: true } } },
    { method: 'cancelPromptEnhancement', args: 'req-3' },
  ]);
  assert.deepEqual(enhanced, { requestId: 'req-3', text: 'Wrapped', model: 'claude-sonnet-4-6', usage: undefined });
  assert.deepEqual(cancelled, { cancelled: true, requestId: 'req-3' });
});
