import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (filePath) => readFileSync(new URL(filePath, root), 'utf8');

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
