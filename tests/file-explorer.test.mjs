import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ChatView mounts a collapsible PyCharm-style file explorer beside the chat pane', () => {
  const source = read('src/views/ChatView.tsx');
  const styles = read('src/index.css');

  assert.match(source, /import FileExplorer from '\.\.\/components\/FileExplorer';/);
  assert.match(source, /<FileExplorer key=\{workspaceVersion\} \/>/);
  assert.match(source, /<div className="chat-pane">/);
  assert.match(styles, /\.chat-view\s*\{[^}]*flex-direction:\s*row;/s);
  assert.match(styles, /\.file-explorer\.collapsed\s*\{/s);
});

test('FileExplorer can load the project tree, open a file, edit it, and save changes', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /\/api\/files\/tree\?path=\./);
  assert.match(source, /\/api\/files\/content\?path=/);
  assert.match(source, /method:\s*'PUT'/);
  assert.match(source, /setDirty\([^)]* !== loadedContent\)/);
  assert.match(source, /className="file-editor-textarea"/);
});

test('FileExplorer shows the real project tree instead of hiding common workspace folders', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.doesNotMatch(source, /HIDDEN_TREE_NAMES/);
  assert.doesNotMatch(source, /visibleNodes/);
  assert.match(source, /maxItems=10000/);
});

test('file save API only writes workspace text files and protects config folders', () => {
  const source = read('server/index.js');

  assert.match(source, /app\.put\('\/api\/files\/content'/);
  assert.match(source, /isProtectedWorkspacePath/);
  assert.match(source, /segments\.includes\('\.claude'\)/);
  assert.match(source, /BINARY_EXTS\.has\(ext\)/);
});

test('file tree includes current directory entries before spending the item budget on nested folders', () => {
  const source = read('server/index.js');

  assert.match(source, /const directoryNodes = \[\];/);
  assert.match(source, /directoryNodes\.push/);
  assert.match(source, /for \(const directoryNode of directoryNodes\)/);
});

test('file tree API allows the explorer to request a larger item budget', () => {
  const source = read('server/index.js');

  assert.match(source, /req\.query\.maxItems/);
  assert.match(source, /maxItems/);
  assert.match(source, /buildTree\(targetPath, \{ depth, showDotfiles, maxItems \}\)/);
});
