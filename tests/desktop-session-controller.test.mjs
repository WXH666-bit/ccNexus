import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopSessionController } from '../desktop/runtime/sessionController.js';

test('loading a desktop session keeps a ccgui-style daemon visible for that chat', async () => {
  const ensuredDaemons = [];
  const messages = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'build a vivo style static page' }],
    },
  ];

  const controller = createDesktopSessionController({
    runtime: {
      ensureSessionDaemon(args) {
        ensuredDaemons.push(args);
      },
    },
    sessions: {
      loadSession: async (sessionId) => ({ type: 'session_history', sessionId, messages }),
    },
  });

  const history = await controller.loadSession('session-1');

  assert.equal(history.sessionId, 'session-1');
  assert.deepEqual(ensuredDaemons, [{
    sessionId: 'session-1',
    title: 'build a vivo style static page',
  }]);
});
