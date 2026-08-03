import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingClaudeConversationError, staleSessionErrorEvent } from '../server/sessionRecovery.js';

test('recognizes a Claude Code resume error caused by an externally deleted conversation', () => {
  assert.equal(
    isMissingClaudeConversationError('Claude Code returned an error result: No conversation found with session ID: abc'),
    true,
  );
});

test('does not treat unrelated provider failures as deleted conversations', () => {
  assert.equal(isMissingClaudeConversationError('Request timed out'), false);
});

test('includes the invalid local session id in the same error event', () => {
  assert.deepEqual(
    staleSessionErrorEvent('No conversation found with session ID: stale-1', 'stale-1'),
    {
      type: 'error',
      message: 'No conversation found with session ID: stale-1',
      invalidSessionId: 'stale-1',
      sessionId: 'stale-1',
    },
  );
});
