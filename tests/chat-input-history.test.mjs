import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendInputHistory,
  loadInputHistory,
  saveInputHistory,
  INPUT_HISTORY_STORAGE_KEY,
  MAX_INPUT_HISTORY_ITEMS,
} from '../src/utils/inputHistory.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('input history follows ccgui ordering and removes duplicate fragments', () => {
  const next = appendInputHistory(['older', 'same'], 'same, new command');

  assert.deepEqual(next, ['older', 'same', 'new', 'command', 'same, new command']);
});

test('input history stays bounded to the ccgui maximum', () => {
  let history = [];
  for (let index = 0; index < MAX_INPUT_HISTORY_ITEMS + 5; index += 1) {
    history = appendInputHistory(history, `message-${index}`);
  }

  assert.equal(history.length, MAX_INPUT_HISTORY_ITEMS);
  assert.equal(history[0], 'message-5');
  assert.equal(history.at(-1), `message-${MAX_INPUT_HISTORY_ITEMS + 4}`);
});

test('input history storage ignores malformed values and round-trips valid entries', () => {
  const storage = createStorage({ [INPUT_HISTORY_STORAGE_KEY]: '{bad json' });
  assert.deepEqual(loadInputHistory(storage), []);

  const history = appendInputHistory([], 'hello world');
  saveInputHistory(history, storage);
  assert.deepEqual(loadInputHistory(storage), ['hello', 'world', 'hello world']);
});
