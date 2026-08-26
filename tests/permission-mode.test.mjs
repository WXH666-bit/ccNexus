import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostToolUseHook,
  createPreToolUseHook,
  normalizeAllowedPrompts,
  normalizePermissionMode,
  normalizePlanTargetMode,
} from '../desktop/daemon/permissionMode.js';

test('normalizes only the five supported permission modes', () => {
  assert.equal(normalizePermissionMode('auto'), 'auto');
  assert.equal(normalizePermissionMode('bypassPermissions'), 'bypassPermissions');
  assert.equal(normalizePermissionMode('unknown'), 'default');
  assert.equal(normalizePermissionMode('unknown', 'plan'), 'plan');
});

test('plan target mode never accepts full access', () => {
  assert.equal(normalizePlanTargetMode('default'), 'default');
  assert.equal(normalizePlanTargetMode('acceptEdits'), 'acceptEdits');
  assert.equal(normalizePlanTargetMode('auto'), 'auto');
  assert.equal(normalizePlanTargetMode('bypassPermissions'), null);
});

test('normalizes and bounds allowed prompts', () => {
  const prompts = normalizeAllowedPrompts([
    { tool: 'Bash', prompt: 'run tests' },
    { tool: 'Edit', prompt: 'x'.repeat(5_000) },
    { tool: '', prompt: 'discarded' },
    null,
  ]);

  assert.deepEqual(prompts, [
    { tool: 'Bash', prompt: 'run tests' },
    { tool: 'Edit', prompt: 'x'.repeat(4_000) },
  ]);
});

test('EnterPlanMode applies plan before allowing the tool', async () => {
  const calls = [];
  const modeState = { current: 'default' };
  const hook = createPreToolUseHook({
    modeState,
    requestPlanApproval: async () => {
      throw new Error('should not ask when entering plan mode');
    },
    applyMode: async mode => {
      calls.push(mode);
      modeState.current = mode;
    },
  });

  const result = await hook({
    tool_name: 'EnterPlanMode',
    tool_input: {},
  });

  assert.deepEqual(calls, ['plan']);
  assert.equal(modeState.current, 'plan');
  assert.equal(result.hookSpecificOutput.permissionDecision, 'allow');
});

test('approved ExitPlanMode applies auto before allowing the tool', async () => {
  const calls = [];
  const modeState = { current: 'plan' };
  const hook = createPreToolUseHook({
    modeState,
    requestPlanApproval: async request => {
      calls.push(['approval', request]);
      return { approved: true, targetMode: 'auto' };
    },
    applyMode: async mode => {
      calls.push(['mode', mode]);
      modeState.current = mode;
    },
  });

  const result = await hook({
    tool_name: 'ExitPlanMode',
    tool_input: {
      plan: 'x'.repeat(100_010),
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    },
  });

  assert.equal(calls[0][0], 'approval');
  assert.equal(calls[0][1].plan.length, 100_000);
  assert.deepEqual(calls[0][1].allowedPrompts, [
    { tool: 'Bash', prompt: 'run tests' },
  ]);
  assert.deepEqual(calls[1], ['mode', 'auto']);
  assert.equal(modeState.current, 'auto');
  assert.equal(result.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(result.hookSpecificOutput.updatedInput, {
    plan: 'x'.repeat(100_000),
    allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    approved: true,
    targetMode: 'auto',
  });
});

test('rejected or invalid plan approval denies without applying a mode', async () => {
  for (const decision of [
    { approved: false, feedback: 'not yet' },
    { approved: true, targetMode: 'bypassPermissions' },
  ]) {
    const applied = [];
    const hook = createPreToolUseHook({
      modeState: { current: 'plan' },
      requestPlanApproval: async () => decision,
      applyMode: async mode => applied.push(mode),
    });

    const result = await hook({
      tool_name: 'ExitPlanMode',
      tool_input: { plan: 'Plan' },
    });

    assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
    assert.deepEqual(applied, []);
  }
});

test('unrelated tools pass through native permission handling', async () => {
  const hook = createPreToolUseHook({
    modeState: { current: 'plan' },
    requestPlanApproval: async () => ({ approved: true, targetMode: 'auto' }),
    applyMode: async () => {},
  });

  assert.deepEqual(await hook({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/example.ts' },
  }), { continue: true });
});

test('web tools execute before review regardless of the current SDK permission mode', async () => {
  const hook = createPreToolUseHook({
    modeState: { current: 'auto' },
    requestPlanApproval: async () => ({ approved: true, targetMode: 'auto' }),
    applyMode: async () => {},
  });

  const result = await hook({ tool_name: 'WebSearch', tool_input: { query: 'ccNexus' } });
  assert.equal(result.hookSpecificOutput.permissionDecision, 'allow');
});

test('isolated prompt enhancement denies web tools before the review pipeline', async () => {
  const hook = createPreToolUseHook({
    modeState: { current: 'auto' },
    requestPlanApproval: async () => ({ approved: true, targetMode: 'auto' }),
    applyMode: async () => {},
    isolatedDenyAllTools: true,
  });

  const result = await hook({ tool_name: 'WebSearch', tool_input: { query: 'do not run' } });
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /cannot use tools/);
});

test('web tool output waits for review and is replaced when rejected', async () => {
  let resolveReview;
  const hook = createPostToolUseHook({
    requestWebResearchReview: () => new Promise(resolve => { resolveReview = resolve; }),
  });
  let settled = false;
  const pending = hook({
    tool_name: 'WebSearch',
    tool_input: { query: 'ccNexus' },
    tool_response: { results: [{ title: 'ccNexus', url: 'https://example.com' }] },
  }, 'tool-use-1').then(result => {
    settled = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  resolveReview({ behavior: 'deny', message: 'Not approved' });
  const result = await pending;
  assert.equal(result.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.deepEqual(result.hookSpecificOutput.updatedToolOutput, {
    error: 'Not approved',
    rejectedByUser: true,
  });
});

test('approved web tool output passes through unchanged', async () => {
  const hook = createPostToolUseHook({
    requestWebResearchReview: async () => ({ behavior: 'allow' }),
  });
  assert.deepEqual(await hook({
    tool_name: 'WebSearch',
    tool_input: { query: 'ccNexus' },
    tool_response: { results: [] },
  }, 'tool-use-2'), { continue: true });
});

test('a reviewed retry replaces the web output before it reaches the Agent', async () => {
  const reviewOverride = {
    query: 'ccNexus',
    results: [{ title: 'Fresh result', url: 'https://example.com/fresh' }],
  };
  const hook = createPostToolUseHook({
    requestWebResearchReview: async () => ({ behavior: 'allow', webReviewOverride: reviewOverride }),
  });
  assert.deepEqual(await hook({
    tool_name: 'WebSearch',
    tool_input: { query: 'ccNexus' },
    tool_response: { results: [{ title: 'Old result', url: 'https://example.com/old' }] },
  }, 'tool-use-3'), {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: reviewOverride,
    },
  });
});
