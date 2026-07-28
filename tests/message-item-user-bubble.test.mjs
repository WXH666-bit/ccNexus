import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('user messages place timestamp and copy action outside the blue bubble', () => {
  const source = read('src/components/MessageItem.tsx');

  assert.match(source, /user-message-stack/);
  assert.match(source, /user-message-actions/);
  assert.match(source, /user-copy-btn/);
  assert.match(
    source,
    /<div className="user-message-actions">[\s\S]*?<\/div>\s*<div className="message-bubble user-bubble">[\s\S]*?message-text user-message-text/
  );
});

test('user message bubble uses a restrained chat style with visible copy affordance', () => {
  const styles = read('src/index.css');

  assert.match(styles, /--user-bubble:\s*#1f5f9f;/);
  assert.match(styles, /\.user-message-stack\s*\{[^}]*align-items:\s*flex-end;/s);
  assert.match(styles, /\.user-bubble\s*\{[^}]*padding:\s*12px 16px 14px;/s);
  assert.doesNotMatch(styles, /\.user-message-actions\s*\{[^}]*position:\s*absolute;/s);
  assert.match(styles, /\.copy-btn\.user-copy-btn\s*\{[^}]*background:\s*rgba\(43,\s*45,\s*48,\s*0\.76\);/s);
  assert.match(styles, /\.user-row:hover \.user-copy-btn/s);
});
