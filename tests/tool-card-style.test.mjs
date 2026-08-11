import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(repoRoot, 'src', 'index.css'), 'utf8')
  .replaceAll('\r\n', '\n');

test('tool cards share one header height and truncate long labels', () => {
  assert.ok(css.includes('/* Shared tool card geometry */'));
  assert.ok(css.includes(
    'height: 42px;\n  min-height: 42px;\n  box-sizing: border-box;\n  overflow: hidden;',
  ));
  assert.ok(css.includes('.tool-block-header .file-link,'));
  assert.ok(css.includes('text-overflow: ellipsis;'));
  assert.ok(css.includes('white-space: nowrap;'));
});

test('tool cards keep a stable width and animate their bodies in place', () => {
  assert.ok(css.includes('/* Stable tool card sizing and expansion */'));
  assert.ok(css.includes(
    '.assistant-row .message-content {\n  width: min(900px, 100%);',
  ));
  assert.ok(css.includes(
    '.assistant-row .message-content > .tool-block,\n.assistant-row .message-content > .tool-group-block,\n.assistant-row .message-content > .agent-group-block {\n  width: 100%;',
  ));
  assert.ok(css.includes('grid-template-rows: 0fr;'));
  assert.ok(css.includes('grid-template-rows: 1fr;'));
});

test('the titlebar logo has enough visual weight', () => {
  const logoRuleStart = css.lastIndexOf('.window-title-logo');
  assert.notEqual(logoRuleStart, -1);
  const logoRule = css.slice(logoRuleStart, logoRuleStart + 320);

  assert.ok(logoRule.includes('width: 20px;'));
  assert.ok(logoRule.includes('height: 20px;'));
  assert.ok(logoRule.includes('flex: 0 0 20px;'));
});
