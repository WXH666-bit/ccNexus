import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.resolve(process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

test('file-change state is persisted per session and survives a renderer remount', async () => {
  const modulePath = pathToFileURL(path.join(root, 'src/utils/fileChangeState.js')).href;
  const state = await import(`${modulePath}?test=${Date.now()}`);
  const storage = new MemoryStorage();

  state.writeKeepAllBase('session-a', 12, storage);
  state.writeKeepAllBase('session-b', 4, storage);
  state.writeProcessedFiles('session-a', ['src/a.ts'], storage);

  assert.equal(state.readKeepAllBase('session-a', storage), 12);
  assert.equal(state.readKeepAllBase('session-b', storage), 4);
  assert.deepEqual(state.readProcessedFiles('session-a', storage), ['src/a.ts']);
  assert.deepEqual(state.readProcessedFiles('session-b', storage), []);
});

test('Keep All management follows ccgui baseline and processed-file boundaries', () => {
  const hook = read('src/hooks/useFileChangesManagement.ts');
  const state = read('src/utils/fileChangeState.js');
  const status = read('src/utils/statusPanelData.ts');
  const chat = read('src/views/ChatView.tsx');

  assert.match(hook, /messagesRef\.current\.length/);
  assert.match(state, /keep-all-base-/);
  assert.match(state, /processed-files-/);
  assert.match(hook, /currentSessionId/);
  assert.match(status, /startFromIndex/);
  assert.match(status, /processedFiles/);
  assert.match(chat, /useFileChangesManagement/);
  assert.match(chat, /baseMessageIndex/);
  assert.match(chat, /processedFiles/);
});

test('undo success, rather than the request itself, records the file as processed', () => {
  const chat = read('src/views/ChatView.tsx');
  const undoCase = chat.slice(chat.indexOf("case 'undo_complete'"), chat.indexOf("case 'undo_complete'") + 700);

  assert.match(undoCase, /if \(msg\.success/);
  assert.match(undoCase, /markFileProcessed/);
});
