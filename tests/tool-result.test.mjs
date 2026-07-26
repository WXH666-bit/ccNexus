import test from 'node:test';
import assert from 'node:assert/strict';
import { extractToolResults } from '../server/toolResults.js';

test('converts SDK tool-result blocks into the client protocol shape', () => {
  assert.deepEqual(extractToolResults({
    content: [
      { type: 'tool_result', tool_use_id: 'tool-1', content: 'package.json contents', is_error: false },
      { type: 'text', text: 'ignored' },
    ],
  }), [{
    type: 'tool_result',
    tool_use_id: 'tool-1',
    content: 'package.json contents',
    is_error: false,
  }]);
});
