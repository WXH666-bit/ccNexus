import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/toolBlocks/BashToolBlock.tsx', import.meta.url), 'utf8');

test('Bash tool block is collapsible from its header like other tool blocks', () => {
  assert.match(source, /useState/);
  assert.match(source, /ChevronDown/);
  assert.match(source, /ChevronRight/);
  assert.match(source, /onClick=\{\(\) => setExpanded\(prev => !prev\)\}/);
  assert.match(source, /\{expanded && \(/);
});

test('Bash header keeps the tool identity on the left and the expand icon on the right', () => {
  assert.match(
    source,
    /<span className="tool-icon">[\s\S]*?<span className="tool-label">Bash<\/span>[\s\S]*?<span className=\{`status-dot \$\{statusClass\}`\} \/>[\s\S]*?<span className="expand-icon">/
  );
});
