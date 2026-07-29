import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (filePath) => readFileSync(new URL(filePath, root), 'utf8');

test('history view exposes an icon button for returning to chat', () => {
  const source = read('src/views/HistoryView.tsx');

  assert.match(source, /ChevronLeft/);
  assert.match(source, /navigate\('\/chat'\)/);
  assert.match(source, /aria-label="Back to chat"/);
});

test('settings view exposes an icon button for returning to chat', () => {
  const source = read('src/views/SettingsView.tsx');

  assert.match(source, /ChevronLeft/);
  assert.match(source, /navigate\('\/chat'\)/);
  assert.match(source, /aria-label="Back to chat"/);
});
