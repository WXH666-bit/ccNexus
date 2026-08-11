import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/toolBlocks/BashToolBlock.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('Bash tool block is collapsible from its header like other tool blocks', () => {
  assert.match(source, /useState/);
  assert.match(source, /onClick=\{\(\) => setExpanded\(prev => !prev\)\}/);
  assert.match(source, /className=\{`tool-block-body \$\{expanded \? 'is-open' : ''\}`\}/);
  assert.match(source, /tool-block-body-inner/);
});

test('Bash header mirrors ccgui by showing the run-command label and command description', () => {
  assert.match(source, /function getCommandSummary/);
  assert.match(source, /input\.description/);
  assert.match(source, /<span className="tool-label">运行命令<\/span>/);
  assert.match(source, /<span className="tool-summary" title=\{commandSummary\}>\{commandSummary\}<\/span>/);
  assert.match(source, /<span className=\{`status-dot \$\{statusClass\}`\} \/>/);
});

test('Bash block uses the thinner ccgui command-row styling', () => {
  assert.match(styles, /\.bash-block\s*\{[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.bash-block \.tool-block-header\s*\{[^}]*border:\s*1px solid var\(--border-color\);/s);
  assert.match(styles, /\.bash-block \.tool-block-body\s*\{[^}]*border-left:\s*1px solid var\(--border-color\);/s);
  assert.match(styles, /\.tool-summary\s*\{[^}]*text-overflow:\s*ellipsis;/s);
});
