import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopSessionController } from '../desktop/runtime/sessionController.js';

test('loading a desktop session stays read-only and does not start a daemon', async () => {
  const messages = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'build a vivo style static page' }],
    },
  ];

  const controller = createDesktopSessionController({
    runtime: {
      ensureSessionDaemon() {
        assert.fail('history loading must not start a daemon');
      },
    },
    sessions: {
      loadSession: async (sessionId) => ({ type: 'session_history', sessionId, messages }),
    },
  });

  const history = await controller.loadSession('session-1');

  assert.equal(history.sessionId, 'session-1');
});

test('history loading works without a runtime dependency', async () => {
  const controller = createDesktopSessionController({
    sessions: {
      loadSession: async sessionId => ({ type: 'session_history', sessionId, messages: [] }),
    },
  });

  assert.deepEqual(await controller.loadSession('session-2'), {
    type: 'session_history',
    sessionId: 'session-2',
    messages: [],
  });
});
