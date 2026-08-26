import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ChatView keeps the project directory on the left and file content in the right sidebar', () => {
  const source = read('src/views/ChatView.tsx');
  const styles = read('src/codex.css');

  assert.match(source, /import FileExplorer, \{ FileContentPanel, type FileEditorState \} from '\.\.\/components\/FileExplorer';/);
  assert.match(source, /<FileExplorer[\s\S]*showEditor=\{false\}[\s\S]*onEditorStateChange=\{handleFileEditorStateChange\}/);
  assert.match(source, /fileContent=\{<FileContentPanel editor=\{fileEditorState\} \/>\}/);
  assert.match(source, /<RightWorkspaceSidebar/);
  assert.match(source, /<div className="chat-pane">/);
  assert.match(styles, /\.codex-sidebar-project \.file-tree\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(styles, /\.codex-right-panel \.file-content-panel\s*\{/s);
});

test('FileExplorer can load the project tree, open a file, edit it, and save changes', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /desktopApi\.listFiles/);
  assert.match(source, /desktopApi\.readFile/);
  assert.match(source, /desktopApi\.saveFile/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.match(source, /setDirty\([^)]* !== loadedContent\)/);
  assert.match(source, /className="file-editor-textarea"/);
  assert.match(source, /export function FileContentPanel/);
  assert.match(source, /fileReadRequestRef/);
});

test('Markdown files open in a safe preview and retain an editable source mode', () => {
  const source = read('src/components/FileExplorer.tsx');
  const markdown = read('src/utils/markdown.ts');
  const styles = read('src/index.css');

  assert.match(source, /const MARKDOWN_EXTS = new Set\(\['md', 'markdown'\]\)/);
  assert.match(source, /renderMarkdownDocument/);
  assert.match(source, /renderMarkdown\(source\)/);
  assert.match(markdown, /DOMPurify\.sanitize/);
  assert.match(source, /role="tablist" aria-label="Markdown 查看模式"/);
  assert.match(source, /<span>预览<\/span>/);
  assert.match(source, /<span>编辑<\/span>/);
  assert.match(source, /className="file-markdown-preview markdown-body"/);
  assert.match(source, /dangerouslySetInnerHTML=\{\{ __html: renderedMarkdown \}\}/);
  assert.match(source, /className="file-editor-textarea"/);
  assert.match(source, /loadingFile && <div className="file-editor-loading">正在加载文件…<\/div>/);
  assert.match(styles, /\.file-markdown-preview\.markdown-body\s*\{[^}]*overflow:\s*auto;/s);
});

test('Markdown preview resolves workspace assets and routes links through controlled desktop APIs', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.match(source, /resolveWorkspaceRelativePath/);
  assert.match(source, /data-markdown-src/);
  assert.match(source, /desktopApi\.readFile\(resolvedPath\)/);
  assert.match(source, /desktopApi\.openExternal\(externalUrl\.href\)/);
  assert.match(source, /仅支持打开安全的 HTTP\(S\) 外部链接/);
  assert.match(source, /editor\?\.openLinkedFile\(resolvedPath\)/);
  assert.match(source, /if \(segments\.length === 0\) return null/);
});

test('FileExplorer notifies ChatView so workspace changes reload the current project history', () => {
  const explorer = read('src/components/FileExplorer.tsx');
  const chat = read('src/views/ChatView.tsx');

  assert.match(explorer, /onWorkspaceChange/);
  assert.match(explorer, /onWorkspaceChange\?\.\(data\)/);
  assert.match(chat, /handleWorkspaceChanged/);
  assert.match(chat, /<FileExplorer[\s\S]*onWorkspaceChange=\{handleWorkspaceChanged\}[\s\S]*openFileRequest=\{fileOpenRequest\}/);
});

test('opening a reviewed file activates the right file editor and workspace changes clear it', () => {
  const chat = read('src/views/ChatView.tsx');

  assert.match(chat, /const handleOpenFile = useCallback\(\(filePath: string\) => \{\s*setRightSidebarTab\('file'\);[\s\S]*setFileOpenRequest/);
  assert.match(chat, /const handleWorkspaceChanged = useCallback\(\(\) => \{[\s\S]*setFileEditorState\(null\);[\s\S]*setRightSidebarTab\(null\);/);
});

test('FileExplorer shows the real project tree instead of hiding common workspace folders', () => {
  const source = read('src/components/FileExplorer.tsx');

  assert.doesNotMatch(source, /HIDDEN_TREE_NAMES/);
  assert.doesNotMatch(source, /visibleNodes/);
  assert.match(source, /maxItems: 10000/);
});

test('desktop file service only writes workspace text files and protects config folders', () => {
  const source = read('desktop/runtime/workspaceFiles.js');

  assert.match(source, /isProtectedWorkspacePath/);
  assert.match(source, /segments\.includes\('\.claude'\)/);
  assert.match(source, /BINARY_EXTS\.has\(ext\)/);
});

test('file tree includes current directory entries before spending the item budget on nested folders', () => {
  const source = read('desktop/runtime/workspaceFiles.js');

  assert.match(source, /const directoryNodes = \[\];/);
  assert.match(source, /directoryNodes\.push/);
  assert.match(source, /return \[\.\.\.directoryNodes, \.\.\.children\]/);
});

test('file tree API allows the explorer to request a larger item budget', () => {
  const source = read('desktop/runtime/workspaceFiles.js');

  assert.match(source, /maxItems/);
  assert.match(source, /requestedMaxItems/);
  assert.match(source, /buildTree\(targetPath, \{ depth, showDotfiles: Boolean\(showDotfiles\), maxItems \}\)/);
});
