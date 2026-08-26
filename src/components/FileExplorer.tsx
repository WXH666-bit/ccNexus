import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Code2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  X,
} from 'lucide-react';
import RefreshIcon from './RefreshIcon';
import { renderMarkdown } from '../utils/markdown';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface TreeResponse {
  tree: FileNode[];
  root: string;
  cwd?: string;
  rootName?: string;
}

export interface FileResponse {
  content: string | null;
  isImage?: boolean;
  isBinary?: boolean;
  mimeType?: string;
  path: string;
  size: number;
}

interface WorkspaceChange {
  cwd?: string;
  rootName?: string;
}

interface FileOpenRequest {
  path: string;
  requestId: number;
}

interface FileExplorerProps {
  onWorkspaceChange?: (workspace: WorkspaceChange) => void;
  openFileRequest?: FileOpenRequest | null;
  showEditor?: boolean;
  onEditorStateChange?: (state: FileEditorState) => void;
  onFileSelected?: (path: string) => void;
}

export interface FileEditorState {
  selectedFile: FileNode | null;
  fileMeta: FileResponse | null;
  draft: string;
  dirty: boolean;
  fileError: string;
  loadingFile: boolean;
  saving: boolean;
  notice: string;
  updateDraft: (value: string) => void;
  saveFile: () => void;
  closeFile: () => void;
  openLinkedFile: (path: string) => void;
}

const MARKDOWN_EXTS = new Set(['md', 'markdown']);
const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'json', 'css', 'html', 'md', 'markdown', 'mjs', 'cjs']);

function extensionOf(name: string) {
  const match = /\.([^.]+)$/.exec(name);
  return match?.[1]?.toLowerCase() ?? '';
}

function FileIcon({ node }: { node: FileNode }) {
  if (node.isDirectory) return <Folder size={15} />;
  return CODE_EXTS.has(extensionOf(node.name)) ? <FileCode2 size={15} /> : <FileText size={15} />;
}

function resolveWorkspaceRelativePath(currentPath: string, rawTarget: string) {
  const targetWithoutFragment = rawTarget.split('#', 1)[0].split('?', 1)[0];
  let decodedTarget = targetWithoutFragment;
  try {
    decodedTarget = decodeURIComponent(targetWithoutFragment);
  } catch {
    // Keep the literal path when a link contains malformed percent encoding.
  }

  const normalizedTarget = decodedTarget.replace(/\\/g, '/');
  const segments = normalizedTarget.startsWith('/')
    ? []
    : currentPath.replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean);

  for (const segment of normalizedTarget.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join('/') : null;
}

function renderMarkdownDocument(source: string) {
  const rendered = renderMarkdown(source);
  if (typeof DOMParser === 'undefined') return rendered;

  const parsed = new DOMParser().parseFromString(rendered, 'text/html');
  parsed.body.querySelectorAll('img').forEach(image => {
    const imageSource = image.getAttribute('src')?.trim();
    if (!imageSource) return;
    image.removeAttribute('src');
    image.setAttribute('data-markdown-src', imageSource);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
  });
  parsed.body.querySelectorAll('a').forEach(link => {
    link.setAttribute('rel', 'noreferrer noopener');
  });
  return parsed.body.innerHTML;
}

function assignMarkdownHeadingIds(container: HTMLElement) {
  const usedIds = new Map<string, number>();
  container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
    if (heading.id) return;
    const base = heading.textContent
      ?.trim()
      .toLowerCase()
      .replace(/[^\w\u3400-\u9fff-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `section-${index + 1}`;
    const duplicateCount = usedIds.get(base) || 0;
    usedIds.set(base, duplicateCount + 1);
    heading.id = duplicateCount === 0 ? base : `${base}-${duplicateCount + 1}`;
  });
}

function TreeNode({
  node,
  selectedPath,
  depth,
  expanded,
  onToggle,
  onOpenFile,
}: {
  node: FileNode;
  selectedPath?: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (node: FileNode) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = Boolean(node.children?.length);

  return (
    <div className="file-tree-node">
      <button
        type="button"
        className={`file-tree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (node.isDirectory) onToggle(node.path);
          else onOpenFile(node);
        }}
        title={node.path}
      >
        <span className="file-tree-caret">
          {node.isDirectory && hasChildren ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        <span className="file-tree-icon">
          {node.isDirectory && isExpanded ? <FolderOpen size={15} /> : <FileIcon node={node} />}
        </span>
        <span className="file-tree-name">{node.name}</span>
      </button>
      {node.isDirectory && isExpanded && hasChildren && (
        <div className="file-tree-children">
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileContentPanel({ editor }: { editor: FileEditorState | null }) {
  const selectedPath = editor?.selectedFile?.path || '';
  const isMarkdown = MARKDOWN_EXTS.has(extensionOf(editor?.selectedFile?.name || ''));
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview');
  const [markdownError, setMarkdownError] = useState('');
  const markdownPreviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMarkdownMode(isMarkdown ? 'preview' : 'source');
    setMarkdownError('');
  }, [isMarkdown, selectedPath]);

  const renderedMarkdown = useMemo(() => (
    isMarkdown && markdownMode === 'preview'
      ? renderMarkdownDocument(editor?.draft || '')
      : ''
  ), [editor?.draft, isMarkdown, markdownMode]);

  useEffect(() => {
    const container = markdownPreviewRef.current;
    if (!container || !isMarkdown || markdownMode !== 'preview') return;

    let active = true;
    assignMarkdownHeadingIds(container);
    const desktopApi = window.ccNexusDesktop;

    container.querySelectorAll<HTMLImageElement>('img[data-markdown-src]').forEach(image => {
      const rawSource = image.dataset.markdownSrc?.trim();
      if (!rawSource) return;

      if (rawSource.startsWith('data:image/')) {
        image.src = rawSource;
        return;
      }

      try {
        const externalUrl = new URL(rawSource);
        if (['http:', 'https:'].includes(externalUrl.protocol) && !externalUrl.username && !externalUrl.password) {
          image.referrerPolicy = 'no-referrer';
          image.src = externalUrl.href;
          return;
        }
      } catch {
        // Relative sources are resolved through the workspace IPC below.
      }

      const resolvedPath = resolveWorkspaceRelativePath(selectedPath, rawSource);
      if (!resolvedPath || !desktopApi?.readFile) {
        image.classList.add('is-unavailable');
        return;
      }

      void desktopApi.readFile(resolvedPath)
        .then(result => {
          if (!active) return;
          if (!result.isImage || !result.content || !result.mimeType?.startsWith('image/')) {
            image.classList.add('is-unavailable');
            return;
          }
          image.src = `data:${result.mimeType};base64,${result.content}`;
        })
        .catch(() => {
          if (active) image.classList.add('is-unavailable');
        });
    });

    return () => {
      active = false;
    };
  }, [isMarkdown, markdownMode, renderedMarkdown, selectedPath]);

  const handleMarkdownClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (!link || !markdownPreviewRef.current?.contains(link)) return;

    event.preventDefault();
    const rawHref = link.getAttribute('href')?.trim();
    if (!rawHref) return;

    if (rawHref.startsWith('#')) {
      let anchor = rawHref.slice(1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        // Use the literal fragment when decoding fails.
      }
      const heading = Array.from(markdownPreviewRef.current.querySelectorAll<HTMLElement>('[id]'))
        .find(element => element.id === anchor);
      heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    try {
      const externalUrl = new URL(rawHref);
      if (['http:', 'https:'].includes(externalUrl.protocol) && !externalUrl.username && !externalUrl.password) {
        const desktopApi = window.ccNexusDesktop;
        if (!desktopApi?.openExternal) {
          setMarkdownError('外部链接只能在桌面应用中打开');
          return;
        }
        setMarkdownError('');
        void desktopApi.openExternal(externalUrl.href).catch(() => {
          setMarkdownError('无法打开这个外部链接');
        });
        return;
      }
      setMarkdownError('仅支持打开安全的 HTTP(S) 外部链接');
      return;
    } catch {
      // Relative links are opened inside the workspace below.
    }

    const resolvedPath = resolveWorkspaceRelativePath(selectedPath, rawHref);
    if (!resolvedPath) {
      setMarkdownError('这个链接超出了当前工作区');
      return;
    }
    setMarkdownError('');
    editor?.openLinkedFile(resolvedPath);
  }, [editor, selectedPath]);

  if (!editor?.selectedFile) {
    return <div className="file-editor file-content-panel"><div className="file-editor-placeholder">从左侧目录选择文件查看或修改</div></div>;
  }

  const {
    selectedFile,
    fileMeta,
    draft,
    dirty,
    fileError,
    loadingFile,
    saving,
    notice,
    updateDraft,
    saveFile,
    closeFile,
  } = editor;

  return (
    <div className="file-editor file-content-panel">
      <div className="file-editor-header">
        <div className="file-editor-title" title={selectedFile.path}>
          <FileIcon node={selectedFile} />
          <span>{selectedFile.name}</span>
          {dirty && <em>已修改</em>}
        </div>
        <div className="file-editor-header-tools">
          {isMarkdown && !fileMeta?.isBinary && !fileMeta?.isImage && (
            <div className="file-editor-mode-switch" role="tablist" aria-label="Markdown 查看模式">
              <button type="button" role="tab" aria-selected={markdownMode === 'preview'} className={markdownMode === 'preview' ? 'is-active' : ''} onClick={() => setMarkdownMode('preview')} title="预览 Markdown">
                <Eye size={13} /><span>预览</span>
              </button>
              <button type="button" role="tab" aria-selected={markdownMode === 'source'} className={markdownMode === 'source' ? 'is-active' : ''} onClick={() => setMarkdownMode('source')} title="编辑 Markdown">
                <Code2 size={13} /><span>编辑</span>
              </button>
            </div>
          )}
          <div className="file-editor-actions">
            <button type="button" onClick={saveFile} disabled={!dirty || saving || fileMeta?.isBinary || fileMeta?.isImage} title="保存" aria-label="保存文件">
              <Save size={14} />
            </button>
            <button type="button" onClick={closeFile} title="关闭" aria-label="关闭文件">
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
      {fileError && <div className="file-explorer-error">{fileError}</div>}
      {notice && <div className="file-explorer-notice">{notice}</div>}
      {markdownError && <div className="file-explorer-error">{markdownError}</div>}
      {loadingFile && <div className="file-editor-loading">正在加载文件…</div>}
      {fileMeta?.isImage && fileMeta.content && (
        <div className="file-image-preview">
          <img src={`data:${fileMeta.mimeType};base64,${fileMeta.content}`} alt={selectedFile.name} />
        </div>
      )}
      {fileMeta?.isBinary && <div className="file-explorer-empty">二进制文件暂不支持编辑。</div>}
      {!loadingFile && !fileMeta?.isBinary && !fileMeta?.isImage && isMarkdown && markdownMode === 'preview' && (
        draft.trim() ? (
          <div
            ref={markdownPreviewRef}
            className="file-markdown-preview markdown-body"
            role="tabpanel"
            aria-label="Markdown 预览"
            onClick={handleMarkdownClick}
            dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
          />
        ) : (
          <div className="file-editor-placeholder file-markdown-empty">这个 Markdown 文件目前是空的。切换到编辑即可开始写入。</div>
        )
      )}
      {!loadingFile && !fileMeta?.isBinary && !fileMeta?.isImage && (!isMarkdown || markdownMode === 'source') && (
        <textarea
          className="file-editor-textarea"
          spellCheck={false}
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
        />
      )}
    </div>
  );
}

export default function FileExplorer({
  onWorkspaceChange,
  openFileRequest,
  showEditor = true,
  onEditorStateChange,
  onFileSelected,
}: FileExplorerProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fileExplorerCollapsed') === 'true');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['.']));
  const [rootName, setRootName] = useState('Project');
  const [cwd, setCwd] = useState('');
  const [treeError, setTreeError] = useState('');
  const [loadingTree, setLoadingTree] = useState(false);

  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [loadedContent, setLoadedContent] = useState('');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [fileMeta, setFileMeta] = useState<FileResponse | null>(null);
  const [fileError, setFileError] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const lastOpenRequestRef = useRef(0);
  const fileReadRequestRef = useRef(0);

  const setExplorerCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    localStorage.setItem('fileExplorerCollapsed', String(next));
  }, []);

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    setTreeError('');
    try {
      const desktopApi = window.ccNexusDesktop;
      if (!desktopApi?.listFiles) throw new Error('ccNexus desktop bridge is unavailable');
      const data = await desktopApi.listFiles({
        path: '.',
        depth: 5,
        showDotfiles: true,
        maxItems: 10000,
      }) as TreeResponse;
      setTree(data.tree || []);
      setRootName(data.rootName || 'Project');
      setCwd(data.cwd || '');
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const openProject = useCallback(async () => {
    if (dirty && !window.confirm('当前文件有未保存修改，确定切换项目吗？')) return;
    const desktopApi = window.ccNexusDesktop;
    if (!desktopApi?.openProject) {
      setTreeError('打开项目只在桌面应用中可用');
      return;
    }

    try {
      const project = await desktopApi.openProject();
      if (!project || project.canceled || !project.path) return;
      const data = project;

      fileReadRequestRef.current += 1;
      setSelectedFile(null);
      setFileMeta(null);
      setLoadedContent('');
      setDraft('');
      setDirty(false);
      setLoadingFile(false);
      setExpanded(new Set(['.']));
      setCwd(data.cwd || project.path);
      setRootName(data.rootName || 'Project');
      onWorkspaceChange?.(data);
      void loadTree();
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : 'Failed to open project');
    }
  }, [dirty, loadTree, onWorkspaceChange]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openFile = useCallback(async (node: FileNode) => {
    if (dirty && !window.confirm('当前文件有未保存修改，确定切换文件吗？')) return;
    const readRequestId = ++fileReadRequestRef.current;

    setSelectedFile(node);
    setFileError('');
    setNotice('');
    setFileMeta(null);
    setLoadedContent('');
    setDraft('');
    setDirty(false);
    setLoadingFile(true);
    onFileSelected?.(node.path);

    try {
      const desktopApi = window.ccNexusDesktop;
      if (!desktopApi?.readFile) throw new Error('ccNexus desktop bridge is unavailable');
      const data = await desktopApi.readFile(node.path) as FileResponse;
      if (fileReadRequestRef.current !== readRequestId) return;
      setFileMeta(data);
      if (!data.isBinary && !data.isImage && typeof data.content === 'string') {
        setLoadedContent(data.content);
        setDraft(data.content);
      }
    } catch (err) {
      if (fileReadRequestRef.current !== readRequestId) return;
      setFileError(err instanceof Error ? err.message : 'Failed to open file');
    } finally {
      if (fileReadRequestRef.current === readRequestId) setLoadingFile(false);
    }
  }, [dirty, onFileSelected]);

  const openLinkedFile = useCallback((filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const name = normalizedPath.split('/').filter(Boolean).pop();
    if (!name) return;
    void openFile({ name, path: normalizedPath, isDirectory: false });
  }, [openFile]);

  useEffect(() => {
    if (!openFileRequest || openFileRequest.requestId <= lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openFileRequest.requestId;
    const requestedPath = openFileRequest.path.trim();
    if (!requestedPath) return;

    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    const normalizedRequested = requestedPath.replace(/\\/g, '/');
    const relativePath = normalizedCwd && normalizedRequested.toLowerCase().startsWith(`${normalizedCwd}/`)
      ? normalizedRequested.slice(normalizedCwd.length + 1)
      : normalizedRequested;
    void openFile({
      name: relativePath.split('/').filter(Boolean).pop() || relativePath,
      path: relativePath,
      isDirectory: false,
    });
  }, [cwd, openFile, openFileRequest]);

  const updateDraft = useCallback((value: string) => {
    setDraft(value);
    setDirty(value !== loadedContent);
    setNotice('');
  }, [loadedContent]);

  const saveFile = useCallback(async () => {
    if (!selectedFile || !dirty || saving) return;
    setSaving(true);
    setFileError('');
    setNotice('');
    try {
      const desktopApi = window.ccNexusDesktop;
      if (!desktopApi?.saveFile) throw new Error('ccNexus desktop bridge is unavailable');
      await desktopApi.saveFile({ path: selectedFile.path, content: draft });
      setLoadedContent(draft);
      setDirty(false);
      setNotice('已保存');
      void loadTree();
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, loadTree, saving, selectedFile]);

  const closeFile = useCallback(() => {
    if (dirty && !window.confirm('当前文件有未保存修改，确定关闭吗？')) return;
    fileReadRequestRef.current += 1;
    setSelectedFile(null);
    setFileMeta(null);
    setLoadedContent('');
    setDraft('');
    setDirty(false);
    setLoadingFile(false);
    setFileError('');
    setNotice('');
  }, [dirty]);

  const editorState = useMemo<FileEditorState>(() => ({
    selectedFile,
    fileMeta,
    draft,
    dirty,
    fileError,
    loadingFile,
    saving,
    notice,
    updateDraft,
    saveFile: () => { void saveFile(); },
    closeFile,
    openLinkedFile,
  }), [closeFile, dirty, draft, fileError, fileMeta, loadingFile, notice, openLinkedFile, saveFile, saving, selectedFile, updateDraft]);

  useEffect(() => {
    onEditorStateChange?.(editorState);
  }, [editorState, onEditorStateChange]);

  if (collapsed) {
    return (
      <aside className="file-explorer collapsed">
        <button
          type="button"
          className="file-explorer-rail-btn"
          onClick={() => setExplorerCollapsed(false)}
          title="展开文件"
          aria-label="展开文件"
        >
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="file-explorer">
      <div className="file-explorer-header">
        <div className="file-explorer-title">
          <Folder size={17} />
          <div className="file-explorer-title-text">
            <strong>{rootName}</strong>
            {cwd && <span>{cwd}</span>}
          </div>
        </div>
        <div className="file-explorer-actions">
          <button type="button" onClick={openProject} title="打开项目" aria-label="打开项目">
            <FolderPlus size={15} />
          </button>
          <button type="button" onClick={loadTree} title="刷新文件" aria-label="刷新文件" disabled={loadingTree}>
            <RefreshIcon size={15} spinning={loadingTree} />
          </button>
          <button type="button" onClick={() => setExplorerCollapsed(true)} title="收起文件" aria-label="收起文件">
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>

      <div className="file-tree">
        {treeError && <div className="file-explorer-error">{treeError}</div>}
        {!treeError && tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            selectedPath={selectedFile?.path}
            depth={0}
            expanded={expanded}
            onToggle={toggleFolder}
            onOpenFile={openFile}
          />
        ))}
        {!treeError && tree.length === 0 && (
          <div className="file-explorer-empty">{loadingTree ? '正在加载文件...' : '没有可显示的文件'}</div>
        )}
      </div>

      {showEditor && <FileContentPanel editor={editorState} />}
    </aside>
  );
}
