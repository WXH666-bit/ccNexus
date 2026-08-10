import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_WINDOW_CLOSE_BEHAVIOR,
  WINDOW_CLOSE_BEHAVIORS,
  WindowPreferences,
  normalizeWindowCloseBehavior,
  shouldMinimizeToTray,
} from '../desktop/runtime/windowPreferences.js';

test('window close behavior defaults to minimizing into the tray', () => {
  assert.equal(DEFAULT_WINDOW_CLOSE_BEHAVIOR, WINDOW_CLOSE_BEHAVIORS.TRAY);
  assert.equal(normalizeWindowCloseBehavior(undefined), WINDOW_CLOSE_BEHAVIORS.TRAY);
  assert.equal(normalizeWindowCloseBehavior('unknown'), WINDOW_CLOSE_BEHAVIORS.TRAY);
  assert.equal(shouldMinimizeToTray({ closeBehavior: WINDOW_CLOSE_BEHAVIORS.TRAY }), true);
  assert.equal(shouldMinimizeToTray({ closeBehavior: WINDOW_CLOSE_BEHAVIORS.EXIT }), false);
  assert.equal(shouldMinimizeToTray({ closeBehavior: WINDOW_CLOSE_BEHAVIORS.TRAY, isQuitting: true }), false);
});

test('window close preference persists only ccNexus-owned state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-window-preferences-'));
  const stateFile = path.join(directory, 'window.json');
  const preferences = new WindowPreferences({ stateFile });

  assert.deepEqual(await preferences.load(), { closeBehavior: WINDOW_CLOSE_BEHAVIORS.TRAY });
  assert.deepEqual(await preferences.setCloseBehavior(WINDOW_CLOSE_BEHAVIORS.EXIT), {
    closeBehavior: WINDOW_CLOSE_BEHAVIORS.EXIT,
  });
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), {
    closeBehavior: WINDOW_CLOSE_BEHAVIORS.EXIT,
  });

  const restored = new WindowPreferences({ stateFile });
  assert.deepEqual(await restored.load(), { closeBehavior: WINDOW_CLOSE_BEHAVIORS.EXIT });
});
