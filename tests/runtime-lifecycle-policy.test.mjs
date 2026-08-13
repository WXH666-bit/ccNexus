import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
  DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
  RUNTIME_MAX_ABSOLUTE_LIFETIME_MS,
  SESSION_RUNTIME_MAX_IDLE_MS,
  decideRuntimeRetirement,
  getRuntimeRetirementReason,
  isRuntimeRetirementBlocked,
} from '../desktop/runtime/runtimeLifecyclePolicy.js';

test('runtime retirement policy uses 30 minute idle and 6 hour absolute limits', () => {
  const startedAt = 1_000;
  const lastUsedAt = startedAt + 10;

  assert.equal(getRuntimeRetirementReason({
    startedAt,
    lastUsedAt,
    now: lastUsedAt + DEFAULT_RUNTIME_IDLE_TIMEOUT_MS - 1,
  }), null);
  assert.equal(getRuntimeRetirementReason({
    startedAt,
    lastUsedAt,
    now: lastUsedAt + DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
  }), 'idle_timeout');
  assert.equal(getRuntimeRetirementReason({
    startedAt,
    lastUsedAt,
    now: startedAt + DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
  }), 'absolute_lifetime');
});

test('runtime retirement is blocked by work that must not be interrupted', () => {
  assert.equal(isRuntimeRetirementBlocked({}), false);
  assert.equal(isRuntimeRetirementBlocked({ activeRequestId: 'turn-1' }), true);
  assert.equal(isRuntimeRetirementBlocked({ contextUsageRunning: true }), true);
  assert.equal(isRuntimeRetirementBlocked({ pendingContextUsage: 1 }), true);
  assert.equal(isRuntimeRetirementBlocked({ pendingPermissions: 1 }), true);
  assert.equal(isRuntimeRetirementBlocked({ pendingPlanApprovals: 1 }), true);
});

test('decideRuntimeRetirement distinguishes immediate and deferred retirement', () => {
  const idle = {
    daemonStartedAt: 0,
    daemonLastUsedAt: 0,
    activeRequestId: null,
    runtime: { createdAt: 0, lastUsedAt: 0, activeTurnCount: 0, closed: false },
  };
  assert.deepEqual(decideRuntimeRetirement(idle, SESSION_RUNTIME_MAX_IDLE_MS), {
    action: 'retire-now',
    reason: 'idle',
  });
  assert.deepEqual(decideRuntimeRetirement({
    ...idle,
    activeRequestId: 'turn-1',
    runtime: {
      ...idle.runtime,
      createdAt: 0,
      lastUsedAt: RUNTIME_MAX_ABSOLUTE_LIFETIME_MS,
      activeTurnCount: 1,
    },
  }, RUNTIME_MAX_ABSOLUTE_LIFETIME_MS), {
    action: 'retire-after-turn',
    reason: 'absolute-lifetime',
  });
});
