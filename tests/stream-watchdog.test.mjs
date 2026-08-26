import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAM_STALL_TIMEOUT_MS,
  shouldRecoverStalledStream,
} from '../src/utils/streamWatchdog.js';

test('recovers a streaming turn after the ccgui stall timeout passes without deltas', () => {
  assert.equal(
    shouldRecoverStalledStream({
      isStreaming: true,
      lastActivityAt: 1_000,
      now: 1_000 + STREAM_STALL_TIMEOUT_MS,
    }),
    true,
  );
});

test('keeps an active stream open before the stall timeout', () => {
  assert.equal(
    shouldRecoverStalledStream({
      isStreaming: true,
      lastActivityAt: 1_000,
      now: 1_000 + STREAM_STALL_TIMEOUT_MS - 1,
    }),
    false,
  );
});

test('does not recover when there is no active stream', () => {
  assert.equal(
    shouldRecoverStalledStream({
      isStreaming: false,
      lastActivityAt: 1_000,
      now: 1_000 + STREAM_STALL_TIMEOUT_MS + 1,
    }),
    false,
  );
});

test('does not recover while the turn is intentionally waiting on an interaction', () => {
  assert.equal(
    shouldRecoverStalledStream({
      isStreaming: true,
      isRecoverySuspended: true,
      lastActivityAt: 1_000,
      now: 1_000 + STREAM_STALL_TIMEOUT_MS + 1,
    }),
    false,
  );
});
