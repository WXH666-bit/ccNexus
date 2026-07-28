import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionPolicy } from '../server/permissionPolicy.js';

test('safe ccgui tools are allowed without asking the user', async () => {
  let asked = 0;
  const policy = createPermissionPolicy({
    askUser: async () => {
      asked += 1;
      return { behavior: 'deny' };
    },
  });

  assert.deepEqual(await policy.canUseTool('Read', { file_path: 'package.json' }), { behavior: 'allow' });
  assert.deepEqual(await policy.canUseTool('TodoWrite', { todos: [] }), { behavior: 'allow' });
  assert.equal(asked, 0);
});

test('always_allow remembers the tool for later permission checks', async () => {
  let asked = 0;
  const policy = createPermissionPolicy({
    askUser: async () => {
      asked += 1;
      return { behavior: 'always_allow' };
    },
  });

  assert.deepEqual(await policy.canUseTool('Bash', { command: 'npm test' }), { behavior: 'allow' });
  assert.deepEqual(await policy.canUseTool('Bash', { command: 'npm run build' }), { behavior: 'allow' });
  assert.equal(asked, 1);
});

test('Write asks the user instead of being silently allowed or denied', async () => {
  let asked = 0;
  const policy = createPermissionPolicy({
    askUser: async (toolName, input) => {
      asked += 1;
      assert.equal(toolName, 'Write');
      assert.deepEqual(input, { file_path: 'anime.html' });
      return { behavior: 'allow' };
    },
  });

  assert.deepEqual(await policy.canUseTool('Write', { file_path: 'anime.html' }), { behavior: 'allow' });
  assert.equal(asked, 1);
});

test('deny stays a one-time denial and does not poison future checks', async () => {
  const answers = [{ behavior: 'deny', message: 'No' }, { behavior: 'allow' }];
  const policy = createPermissionPolicy({
    askUser: async () => answers.shift(),
  });

  assert.deepEqual(await policy.canUseTool('Bash', { command: 'rm file' }), { behavior: 'deny', message: 'No' });
  assert.deepEqual(await policy.canUseTool('Bash', { command: 'echo ok' }), { behavior: 'allow' });
});
