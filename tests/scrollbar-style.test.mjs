import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('scrollbars use the ccNexus theme instead of native white controls', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

  assert.match(source, /\*::-webkit-scrollbar\s*\{/);
  assert.match(source, /scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/);
  assert.match(source, /\*::-webkit-scrollbar-thumb:hover/);
  assert.match(source, /\*::-webkit-scrollbar-button/);
  assert.match(source, /\[data-theme="light"\][\s\S]*--scrollbar-thumb:/);
});
