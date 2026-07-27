import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ChatView accepts restored history for the latest session when /chat has no session id', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /if\s*\(urlSessionId\s*&&\s*urlSessionId\s*!==\s*msg\.sessionId\)\s*break;/);
});

test('ChatView requests the latest session history after restoring the session list', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const latest = \[\.\.\.msg\.sessions\]\.sort/);
  assert.match(source, /send\(\{\s*type:\s*'load_session',\s*sessionId:\s*latest\.id\s*\}\)/s);
});
