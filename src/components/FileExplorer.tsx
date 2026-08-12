import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
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

interface FileNode {
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

interface FileResponse {
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
}

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'json', 'css', 'html', 'md', 'mjs', 'cjs']);

function extensionOf(name: string) {
  const match = /\.([^.]+)$/.exec(name);
  return match?.[1]?.toLowerCase() ?? '';
}

function FileIcon({ node }: { node: FileNode }) {
  if (node.isDirectory) return <Folder size={15} />;
  return CODE_EXTS.has(extensionOf(node.name)) ? <FileCode2 size={15} /> : <FileText size={15} />;
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

export default function FileExplorer({ onWorkspaceChange, openFileRequest }: FileExplorerProps) {
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
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const lastOpenRequestRef = useRef(0);

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

      setSelectedFile(null);
      setFileMeta(null);
      setLoadedContent('');
      setDraft('');
      setDirty(false);
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

    setSelectedFile(node);
    setFileError('');
    setNotice('');
    setFileMeta(null);
    setLoadedContent('');
    setDraft('');
    setDirty(false);

    try {
      const desktopApi = window.ccNexusDesktop;
      if (!desktopApi?.readFile) throw new Error('ccNexus desktop bridge is unavailable');
      const data = await desktopApi.readFile(node.path) as FileResponse;
      setFileMeta(data);
      if (!data.isBinary && !data.isImage && typeof data.content === 'string') {
        setLoadedContent(data.content);
        setDraft(data.content);
      }
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, [dirty]);

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
    setSelectedFile(null);
    setFileMeta(null);
    setLoadedContent('');
    setDraft('');
    setDirty(false);
    setFileError('');
    setNotice('');
  }, [dirty]);

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

      <div className="file-editor">
        {selectedFile ? (
          <>
            <div className="file-editor-header">
              <div className="file-editor-title" title={selectedFile.path}>
                <FileIcon node={selectedFile} />
                <span>{selectedFile.name}</span>
                {dirty && <em>已修改</em>}
              </div>
              <div className="file-editor-actions">
                <button type="button" onClick={saveFile} disabled={!dirty || saving || fileMeta?.isBinary || fileMeta?.isImage} title="保存">
                  <Save size={14} />
                </button>
                <button type="button" onClick={closeFile} title="关闭">
                  <X size={14} />
                </button>
              </div>
            </div>
            {fileError && <div className="file-explorer-error">{fileError}</div>}
            {notice && <div className="file-explorer-notice">{notice}</div>}
            {fileMeta?.isImage && fileMeta.content && (
              <div className="file-image-preview">
                <img src={`data:${fileMeta.mimeType};base64,${fileMeta.content}`} alt={selectedFile.name} />
              </div>
            )}
            {fileMeta?.isBinary && <div className="file-explorer-empty">二进制文件暂不支持编辑。</div>}
            {!fileMeta?.isBinary && !fileMeta?.isImage && (
              <textarea
                className="file-editor-textarea"
                spellCheck={false}
                value={draft}
                onChange={(event) => updateDraft(event.target.value)}
              />
            )}
          </>
        ) : (
          <div className="file-editor-placeholder">选择文件查看或修改</div>
        )}
      </div>
    </aside>
  );
}
