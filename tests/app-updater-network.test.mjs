import assert from 'node:assert/strict';
import test from 'node:test';
import { configureUpdaterNetwork, getUpdaterProxy } from '../desktop/update/updateNetwork.js';

test('updater proxy prefers HTTPS proxy environment variables', () => {
  assert.equal(
    getUpdaterProxy({
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      HTTP_PROXY: 'http://127.0.0.1:8080',
    }),
    'http://127.0.0.1:7897',
  );
});

test('updater configures the Electron updater session with the detected proxy', async () => {
  const calls = [];
  const result = await configureUpdaterNetwork({
    env: { https_proxy: 'http://127.0.0.1:7897' },
    updaterSession: {
      async setProxy(value) {
        calls.push(value);
      },
    },
  });

  assert.deepEqual(calls, [{
    proxyRules: 'http://127.0.0.1:7897',
    proxyBypassRules: '<local>',
  }]);
  assert.deepEqual(result, { configured: true, proxy: 'http://127.0.0.1:7897' });
});
