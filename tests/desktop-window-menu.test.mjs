import assert from 'node:assert/strict';
import test from 'node:test';
import { hideDefaultApplicationMenu } from '../desktop/runtime/windowMenu.js';

test('desktop window hides the default Electron application menu', () => {
  const calls = [];
  const Menu = {
    setApplicationMenu(value) {
      calls.push(value);
    },
  };

  hideDefaultApplicationMenu(Menu);

  assert.deepEqual(calls, [null]);
});
