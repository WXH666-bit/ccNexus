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

test('web research tools require a fresh result review even after always_allow', async () => {
  let asked = 0;
  const policy = createPermissionPolicy({
    askUser: async () => {
      asked += 1;
      return { behavior: 'always_allow' };
    },
  });

  assert.deepEqual(await policy.canUseTool('WebSearch', { query: 'first' }), { behavior: 'allow' });
  assert.deepEqual(await policy.canUseTool('WebSearch', { query: 'second' }), { behavior: 'allow' });
  assert.deepEqual(await policy.canUseTool('WebFetch', { url: 'https://example.com' }), { behavior: 'allow' });
  assert.deepEqual(await policy.canUseTool('WebFetch', { url: 'https://example.org' }), { behavior: 'allow' });
  assert.equal(asked, 4);
});

test('web review overrides survive the permission policy handoff', async () => {
  const webReviewOverride = { query: 'ccNexus', results: [] };
  const policy = createPermissionPolicy({
    askUser: async () => ({ behavior: 'allow', webReviewOverride }),
  });
  assert.deepEqual(await policy.canUseTool('WebSearch', { query: 'ccNexus' }), {
    behavior: 'allow',
    webReviewOverride,
  });
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

test('AskUserQuestion blocks on the renderer and returns answers as updated input', async () => {
  let asked = 0;
  const policy = createPermissionPolicy({
    askUser: async () => {
      throw new Error('AskUserQuestion must not use the generic permission dialog');
    },
    askQuestion: async (input) => {
      asked += 1;
      assert.equal(input.questions[0].question, 'Which option?');
      return { answers: { 'Which option?': 'A' } };
    },
  });

  assert.deepEqual(await policy.canUseTool('AskUserQuestion', {
    questions: [{ question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }] }],
  }), {
    behavior: 'allow',
    updatedInput: {
      questions: [{ question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }] }],
      answers: { 'Which option?': 'A' },
    },
  });
  assert.equal(asked, 1);
});
