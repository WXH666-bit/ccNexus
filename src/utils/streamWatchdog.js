export const STREAM_STALL_TIMEOUT_MS = 60_000;
export const STREAM_STALL_CHECK_INTERVAL_MS = 5_000;

export function shouldRecoverStalledStream({
  isStreaming,
  lastActivityAt,
  now,
  timeoutMs = STREAM_STALL_TIMEOUT_MS,
}) {
  if (!isStreaming) return false;
  return now - lastActivityAt >= timeoutMs;
}
