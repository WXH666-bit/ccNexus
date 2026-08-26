export const STREAM_STALL_TIMEOUT_MS: number;
export const STREAM_STALL_CHECK_INTERVAL_MS: number;

export function shouldRecoverStalledStream(args: {
  isStreaming: boolean;
  isRecoverySuspended?: boolean;
  lastActivityAt: number;
  now: number;
  timeoutMs?: number;
}): boolean;
