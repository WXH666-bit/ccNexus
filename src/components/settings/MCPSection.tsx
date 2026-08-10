import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleOff,
  ExternalLink,
  FileJson,
  Folder,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  deleteMcpServer,
  getMcpServerForEdit,
  getMcpStatus,
  getMcpTools,
  getMcpServers,
  saveMcpServer,
  toggleMcpServer,
} from '../../utils/desktopBridgeApi';
import { buildMcpViewModel } from '../../utils/mcpViewModel';

type McpScope = 'global' | 'project';
type McpStatusFilter = 'all' | 'connected' | 'pending' | 'failed' | 'disabled' | 'invalid';
type McpTransport = 'stdio' | 'sse' | 'http' | 'streamable-http';
type JsonRecord = Record<string, unknown>;

interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
  scope: McpScope;
  config: JsonRecord;
}

interface McpState {
  servers?: McpServer[];
  disabled?: Array<{ id: string; scope: McpScope; reason: string }>;
  invalid?: Array<{ id: string; scope: McpScope; reason: string; config: JsonRecord }>;
  scope?: string;
  error?: string;
}

interface McpStatus {
  id: string;
  scope: McpScope;
  status: 'connected' | 'failed' | 'pending';
  serverInfo?: JsonRecord | null;
  error?: string | null;
}

interface McpTools {
  id: string;
  scope: McpScope;
  serverType: string | null;
  tools: JsonRecord[];
  error?: string | null;
}

interface McpEditorProps {
  initial?: { id: string; scope: McpScope; config: JsonRecord };
  onClose: () => void;
  onSave: (payload: { id: string; scope: McpScope; config: JsonRecord }) => Promise<void>;
}

function prettyJson(value: unknown, fallback: JsonRecord | unknown[] = {}) {
  return JSON.stringify(value ?? fallback, null, 2);
}

function parseJson(text: string, label: string, fallback: JsonRecord | unknown[]) {
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 必须是有效 JSON`);
  }
}

function statusLabel(status: string) {
  if (status === 'connected') return '已连接';
  if (status === 'pending') return '检查中';
  if (status === 'disabled') return '已禁用';
  if (status === 'invalid') return '配置无效';
  return '连接失败';
}

function statusIcon(status: string) {
  if (status === 'connected') return <Check size={14} />;
  if (status === 'disabled') return <CircleOff size={14} />;
  if (status === 'invalid') return <AlertTriangle size={14} />;
  return <Circle size={10} />;
}

export default function MCPSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<McpState | null>(null);
  const [statuses, setStatuses] = useState<McpStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | McpScope>('all');
  const [statusFilter, setStatusFilter] = useState<McpStatusFilter>('all');
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; server?: { id: string; scope: McpScope; config: JsonRecord } } | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpTools>>({});
  const [toolsLoading, setToolsLoading] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextState = await getMcpServers() as McpState;
      setState(nextState);
      try {
        setStatuses(await getMcpStatus());
      } catch (statusError) {
        setStatuses([]);
        setError(statusError instanceof Error ? statusError.message : String(statusError));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const model = useMemo(() => buildMcpViewModel(state || {}, statuses, {
    search,
    scope: scopeFilter,
    status: statusFilter,
  }), [search, scopeFilter, state, statusFilter, statuses]);

  const reloadAfterChange = async () => {
    setEditor(null);
    setExpanded(null);
    setToolsByServer({});
    await loadServers();
  };

  const handleToggle = async (item: ReturnType<typeof buildMcpViewModel>['items'][number]) => {
    try {
      await toggleMcpServer({ id: item.id, scope: item.scope as McpScope, enabled: !item.enabled });
      await reloadAfterChange();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  };

  const handleDelete = async (item: ReturnType<typeof buildMcpViewModel>['items'][number]) => {
    if (!window.confirm(`确定删除 MCP 服务器“${item.id}”吗？`)) return;
    try {
      await deleteMcpServer({ id: item.id, scope: item.scope as McpScope });
      await reloadAfterChange();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const handleEdit = async (item: ReturnType<typeof buildMcpViewModel>['items'][number]) => {
    setEditorLoading(true);
    setError('');
    try {
      const server = await getMcpServerForEdit({ id: item.id, scope: item.scope as McpScope });
      setEditor({ mode: 'edit', server });
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : String(editError));
    } finally {
      setEditorLoading(false);
    }
  };

  const handleExpand = async (item: ReturnType<typeof buildMcpViewModel>['items'][number]) => {
    const key = `${item.id}:${item.scope}`;
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    if (item.kind !== 'server' || toolsByServer[key]) return;
    setToolsLoading(key);
    try {
      const result = await getMcpTools({ id: item.id, scope: item.scope as McpScope });
      setToolsByServer(previous => ({ ...previous, [key]: result }));
    } catch (toolError) {
      setToolsByServer(previous => ({
        ...previous,
        [key]: { id: item.id, scope: item.scope as McpScope, serverType: null, tools: [], error: toolError instanceof Error ? toolError.message : String(toolError) },
      }));
    } finally {
      setToolsLoading(null);
    }
  };

  const handleSave = async ({ id, scope, config }: { id: string; scope: McpScope; config: JsonRecord }) => {
    await saveMcpServer({ id, scope, config });
    await reloadAfterChange();
  };

  return (
    <div className="settings-section-content settings-management-section">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.mcp.title')}</h3>
          <p className="settings-desc">管理 Claude Code 的 MCP 服务器。这里的启停、编辑和删除会直接同步 Claude 配置，不会触碰 cc-switch 供应商或凭据。</p>
        </div>
        <div className="settings-heading-actions">
          <button className="provider-primary-button" onClick={() => setEditor({ mode: 'create' })}>
            <Plus size={15} /> 添加服务器
          </button>
          <button className="icon-button" onClick={() => void loadServers()} disabled={loading} title="刷新">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="provider-error" role="alert">{error}</div>}
      <div className="mcp-summary-strip">
        <div><strong>{model.counts.all}</strong><span>全部服务器</span></div>
        <div className="is-connected"><strong>{model.counts.connected}</strong><span>已连接</span></div>
        <div className="is-disabled"><strong>{model.counts.disabled}</strong><span>已禁用</span></div>
        <div className="is-failed"><strong>{model.counts.failed}</strong><span>失败/异常</span></div>
      </div>

      <div className="mcp-filter-toolbar">
        <div className="mcp-search-box">
          <Search size={15} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索服务器或连接地址" aria-label="搜索 MCP 服务器" />
        </div>
        <select value={scopeFilter} onChange={event => setScopeFilter(event.target.value as 'all' | McpScope)} aria-label="MCP 作用域">
          <option value="all">全部作用域</option>
          <option value="global">全局</option>
          <option value="project">当前项目</option>
        </select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as McpStatusFilter)} aria-label="MCP 状态">
          <option value="all">全部状态</option>
          <option value="connected">已连接</option>
          <option value="pending">检查中</option>
          <option value="failed">连接失败</option>
          <option value="disabled">已禁用</option>
          <option value="invalid">配置无效</option>
        </select>
      </div>

      {loading && !state ? <div className="empty-state"><p>{t('common.loading')}</p></div> : model.items.length === 0 ? (
        <div className="empty-state">
          <Server size={42} className="empty-icon" />
          <p>{state?.servers?.length || state?.disabled?.length || state?.invalid?.length ? '没有符合筛选条件的 MCP 服务器' : t('settings.mcp.empty')}</p>
          <button className="provider-secondary-button" onClick={() => setEditor({ mode: 'create' })}><Plus size={14} /> 添加服务器</button>
        </div>
      ) : (
        <div className="mcp-card-list">
          {model.items.map(item => {
            const key = `${item.id}:${item.scope}`;
            const toolState = toolsByServer[key];
            return (
              <article key={key} className={`mcp-server-card ${item.enabled ? '' : 'is-muted'} ${expanded === key ? 'is-expanded' : ''}`}>
                <div className="mcp-card-main">
                  <button className={`mcp-toggle ${item.enabled ? 'is-on' : ''}`} onClick={() => void handleToggle(item)} title={item.enabled ? '禁用服务器' : '启用服务器'} aria-label={item.enabled ? `禁用 ${item.id}` : `启用 ${item.id}`}>
                    <span />
                  </button>
                  <div className="mcp-card-icon"><Server size={19} /></div>
                  <div className="mcp-card-copy">
                    <div className="mcp-card-title-row">
                      <strong>{item.name || item.id}</strong>
                      <span className={`mcp-scope-badge ${item.scope}`}><span>{item.scope === 'project' ? <Folder size={11} /> : <Circle size={8} />}</span>{item.scope === 'project' ? '项目' : '全局'}</span>
                      <span className={`mcp-status-badge ${item.statusKey}`}>{statusIcon(item.statusKey)}{statusLabel(item.statusKey)}</span>
                    </div>
                    <span className="mcp-card-id">{item.id}</span>
                    <span className="mcp-card-connection">{item.connection || item.error}</span>
                  </div>
                  <div className="mcp-card-actions">
                    <button className="provider-icon-button" onClick={() => void handleExpand(item)} title={expanded === key ? '收起详情' : '展开详情'} aria-label={expanded === key ? '收起详情' : '展开详情'}>
                      {expanded === key ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <button className="provider-icon-button" onClick={() => void handleEdit(item)} disabled={editorLoading} title="编辑" aria-label={`编辑 ${item.id}`}><Pencil size={15} /></button>
                    <button className="provider-icon-button danger" onClick={() => void handleDelete(item)} title="删除" aria-label={`删除 ${item.id}`}><Trash2 size={15} /></button>
                  </div>
                </div>
                {expanded === key && (
                  <div className="mcp-card-details">
                    <div className="mcp-detail-line"><span>连接方式</span><code>{item.connection || '未提供'}</code></div>
                    <div className="mcp-detail-line"><span>配置范围</span><code>{item.scope === 'project' ? '当前项目 .claude.json' : '用户 ~/.claude.json'}</code></div>
                    {item.error && <div className="mcp-detail-error"><AlertTriangle size={14} />{item.error}</div>}
                    {item.kind === 'server' && (
                      <div className="mcp-tools-panel">
                        <div className="mcp-tools-heading"><span><Wrench size={14} />工具列表</span>{toolsLoading === key ? <span>读取中…</span> : <span>{toolState?.tools.length ?? '—'}</span>}</div>
                        {toolState?.error ? <p className="mcp-tools-error">{toolState.error}</p> : toolState && toolState.tools.length > 0 ? <div className="mcp-tools-list">{toolState.tools.map((tool, index) => <code key={`${String(tool.name || 'tool')}-${index}`}>{String(tool.name || '未命名工具')}</code>)}</div> : toolsLoading !== key ? <p className="mcp-tools-empty">暂无工具或尚未返回工具列表</p> : null}
                      </div>
                    )}
                    <div className="mcp-detail-actions"><button className="provider-secondary-button small" onClick={() => void handleEdit(item)}><Pencil size={13} /> 编辑配置</button><button className="provider-secondary-button small" onClick={() => void handleToggle(item)}>{item.enabled ? '禁用服务器' : '启用服务器'}</button></div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {editor && <McpServerEditor initial={editor.server} onClose={() => setEditor(null)} onSave={handleSave} />}
    </div>
  );
}

function McpServerEditor({ initial, onClose, onSave }: McpEditorProps) {
  const editing = Boolean(initial);
  const initialConfig = initial?.config || {};
  const [id, setId] = useState(initial?.id || '');
  const [scope, setScope] = useState<McpScope>(initial?.scope || 'global');
  const [transport, setTransport] = useState<McpTransport>((initialConfig.type as McpTransport) || (initialConfig.url ? 'http' : 'stdio'));
  const [command, setCommand] = useState(typeof initialConfig.command === 'string' ? initialConfig.command : '');
  const [url, setUrl] = useState(typeof initialConfig.url === 'string' ? initialConfig.url : '');
  const [args, setArgs] = useState(prettyJson(initialConfig.args, []));
  const [env, setEnv] = useState(prettyJson(initialConfig.env, {}));
  const [headers, setHeaders] = useState(prettyJson(initialConfig.headers, {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      if (!id.trim()) throw new Error('服务器名称不能为空');
      const nextConfig: JsonRecord = { ...initialConfig, type: transport };
      if (transport === 'stdio') {
        if (!command.trim()) throw new Error('STDIO 服务器需要填写启动命令');
        const parsedArgs = parseJson(args, '启动参数', []);
        if (!Array.isArray(parsedArgs) || parsedArgs.some(item => typeof item !== 'string')) throw new Error('启动参数必须是字符串数组');
        const parsedEnv = parseJson(env, '环境变量', {});
        if (!parsedEnv || Array.isArray(parsedEnv) || typeof parsedEnv !== 'object') throw new Error('环境变量必须是 JSON 对象');
        nextConfig.command = command.trim();
        nextConfig.args = parsedArgs;
        delete nextConfig.url;
        nextConfig.env = parsedEnv;
        delete nextConfig.headers;
      } else {
        if (!url.trim()) throw new Error('HTTP 服务器需要填写 URL');
        const parsedEnv = parseJson(env, '环境变量', {});
        const parsedHeaders = parseJson(headers, '请求头', {});
        if (!parsedEnv || Array.isArray(parsedEnv) || typeof parsedEnv !== 'object') throw new Error('环境变量必须是 JSON 对象');
        if (!parsedHeaders || Array.isArray(parsedHeaders) || typeof parsedHeaders !== 'object') throw new Error('请求头必须是 JSON 对象');
        nextConfig.url = url.trim();
        nextConfig.headers = parsedHeaders;
        nextConfig.env = parsedEnv;
        delete nextConfig.command;
        delete nextConfig.args;
      }
      setSaving(true);
      await onSave({ id: id.trim(), scope, config: nextConfig });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="provider-dialog-overlay" role="presentation">
      <form className="provider-dialog mcp-editor-dialog" onSubmit={event => void submit(event)}>
        <div className="provider-dialog-header"><div><h3>{editing ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</h3><p>写入 Claude Code 的 mcpServers；与 cc-switch 供应商设置相互独立。</p></div><button type="button" className="provider-icon-button" onClick={onClose} aria-label="关闭"><X size={17} /></button></div>
        <div className="provider-dialog-content">
          {error && <div className="provider-error" role="alert">{error}</div>}
          <label className="provider-form-field"><span>服务器名称</span><input value={id} onChange={event => setId(event.target.value)} disabled={editing} placeholder="例如 filesystem" autoFocus={!editing} /></label>
          <div className="mcp-editor-grid">
            <label className="provider-form-field"><span>配置范围</span><select value={scope} onChange={event => setScope(event.target.value as McpScope)} disabled={editing}><option value="global">全局</option><option value="project">当前项目</option></select></label>
            <label className="provider-form-field"><span>传输方式</span><select value={transport} onChange={event => setTransport(event.target.value as McpTransport)}><option value="stdio">STDIO</option><option value="http">HTTP</option><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
          </div>
          {transport === 'stdio' ? <>
            <label className="provider-form-field"><span><Terminal size={13} />启动命令</span><input value={command} onChange={event => setCommand(event.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem" /></label>
            <label className="provider-form-field"><span>启动参数（JSON 数组）</span><textarea value={args} onChange={event => setArgs(event.target.value)} rows={4} spellCheck={false} /></label>
          </> : <label className="provider-form-field"><span><ExternalLink size={13} />服务 URL</span><input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>}
          <div className="mcp-editor-json-grid">
            <label className="provider-form-field"><span><FileJson size={13} />环境变量（JSON 对象）</span><textarea value={env} onChange={event => setEnv(event.target.value)} rows={5} spellCheck={false} /></label>
            {transport !== 'stdio' && <label className="provider-form-field"><span><FileJson size={13} />请求头（JSON 对象）</span><textarea value={headers} onChange={event => setHeaders(event.target.value)} rows={5} spellCheck={false} /></label>}
          </div>
          <p className="mcp-editor-note">请求头和环境变量只在打开编辑器时读取原始值，列表页会自动隐藏其内容。</p>
        </div>
        <div className="provider-dialog-footer"><button type="button" className="provider-secondary-button" onClick={onClose}>取消</button><button type="submit" className="provider-primary-button" disabled={saving}>{saving ? '保存中…' : '保存到 Claude Code'}</button></div>
      </form>
    </div>
  );
}
