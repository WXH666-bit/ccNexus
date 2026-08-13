export const DEFAULT_RUNTIME_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_RUNTIME_RETIREMENT_POLL_MS = 5 * 60 * 1000;
export const SESSION_RUNTIME_MAX_IDLE_MS = DEFAULT_RUNTIME_IDLE_TIMEOUT_MS;
export const RUNTIME_MAX_ABSOLUTE_LIFETIME_MS = DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS;
export const RUNTIME_CLEANUP_INTERVAL_MS = DEFAULT_RUNTIME_RETIREMENT_POLL_MS;

export function getRuntimeRetirementReason({
  startedAt,
  lastUsedAt,
  now = Date.now(),
  idleTimeoutMs = DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
  absoluteLifetimeMs = DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
} = {}) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(lastUsedAt)) return null;
  if (now - startedAt >= absoluteLifetimeMs) return 'absolute_lifetime';
  if (now - lastUsedAt >= idleTimeoutMs) return 'idle_timeout';
  return null;
}

export function isRuntimeRetirementBlocked({
  activeRequestId = null,
  activeTurnCount = 0,
  contextUsageRunning = false,
  pendingContextUsage = 0,
  pendingPermissions = 0,
  pendingPlanApprovals = 0,
} = {}) {
  return Boolean(
    activeRequestId
      || activeTurnCount > 0
      || contextUsageRunning
      || pendingContextUsage > 0
      || pendingPermissions > 0
      || pendingPlanApprovals > 0,
  );
}

export function decideRuntimeRetirement(status, now = Date.now(), overrides = {}) {
  const idleMs = overrides.idleMs ?? SESSION_RUNTIME_MAX_IDLE_MS;
  const absoluteMs = overrides.absoluteMs ?? RUNTIME_MAX_ABSOLUTE_LIFETIME_MS;
  const current = status?.runtime || null;
  const pendingControlCount = status?.pendingControlCount !== undefined
    ? Number(status.pendingControlCount || 0)
    : Number(status?.pendingContextUsage || 0) + (status?.contextUsageRunning ? 1 : 0);
  const blocked = Boolean(status?.activeRequestId)
    || pendingControlCount > 0
    || Number(current?.activeTurnCount || 0) > 0;

  if (!current) {
    if (blocked) return { action: 'keep', reason: 'active' };
    return now - Number(status?.daemonLastUsedAt ?? status?.daemonStartedAt ?? now) >= idleMs
      ? { action: 'retire-now', reason: 'empty-idle' }
      : { action: 'keep', reason: 'within-idle-window' };
  }

  if (current.closed) return { action: 'retire-now', reason: 'runtime-closed' };
  if (now - Number(current.createdAt) >= absoluteMs) {
    return blocked
      ? { action: 'retire-after-turn', reason: 'absolute-lifetime' }
      : { action: 'retire-now', reason: 'absolute-lifetime' };
  }
  if (blocked) return { action: 'keep', reason: 'active' };
  return now - Number(current.lastUsedAt) >= idleMs
    ? { action: 'retire-now', reason: 'idle' }
    : { action: 'keep', reason: 'within-idle-window' };
}
