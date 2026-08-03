import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDesktopEventSessionId,
  isDesktopEventForSession,
  normalizeDesktopChatEvent,
} from '../src/utils/desktopChatEvents.js';

test('desktop event normalization uses the same session id for message and runtime fields', () => {
  const progress = normalizeDesktopChatEvent({
    type: 'tool_progress',
    tool_name: 'Bash',
    tool_use_id: 'tool-1',
    session_id: 'session-a',
  });

  assert.equal(progress.toolName, 'Bash');
  assert.equal(progress.toolUseId, 'tool-1');
  assert.equal(progress.sessionId, 'session-a');
  assert.equal(getDesktopEventSessionId(progress), 'session-a');
});

test('assistant events inherit their nested message session id', () => {
  const event = { type: 'assistant', message: { sessionId: 'session-b', content: [] } };

  assert.equal(getDesktopEventSessionId(event), 'session-b');
  assert.equal(isDesktopEventForSession(event, 'session-b'), true);
  assert.equal(isDesktopEventForSession(event, 'session-a'), false);
});

test('global events are accepted while session-scoped events from another turn are ignored', () => {
  assert.equal(isDesktopEventForSession({ type: 'session_list', sessions: [] }, 'session-a'), true);
  assert.equal(isDesktopEventForSession({ type: 'status', status: 'idle' }, 'session-a'), true);
  assert.equal(isDesktopEventForSession({ type: 'result', sessionId: 'session-b' }, 'session-a'), false);
  assert.equal(isDesktopEventForSession({ type: 'tool_result', sessionId: 'session-a' }, 'session-a'), true);
});
