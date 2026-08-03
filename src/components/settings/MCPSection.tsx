import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CircleCheck, CircleOff, RefreshCw, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getMcpServers } from '../../utils/desktopBridgeApi';

interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
  scope: string;
  config: Record<string, unknown>;
}

interface McpState {
  servers?: McpServer[];
  disabled?: string[];
  invalid?: Array<{ id: string; reason: string }>;
  scope?: string;
}

function connectionText(config: Record<string, unknown>) {
  if (typeof config.url === 'string') return config.url;
  const command = typeof config.command === 'string' ? config.command : '';
  const args = Array.isArray(config.args) ? config.args.filter(item => typeof item === 'string').join(' ') : '';
  return `${command}${args ? ` ${args}` : ''}`.trim() || '未提供连接信息';
}

export default function MCPSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<McpState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await getMcpServers());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  return (
    <div className="settings-section-content">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.mcp.title')}</h3>
          <p className="settings-desc">{t('settings.mcp.desc')} 当前按 ccgui 方式读取 Claude MCP 状态，不修改配置。</p>
        </div>
        <button className="icon-button" onClick={() => void loadServers()} disabled={loading} title="刷新">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading && !state ? <div className="empty-state"><p>{t('common.loading')}</p></div> : error ? <div className="empty-state"><p>{error}</p></div> : (
        <div className="mcp-settings-list">
          <div className="settings-info-note"><Server size={15} /> 当前作用域：{state?.scope === 'project' ? '项目' : '全局'}</div>
          {(state?.servers || []).map(server => (
            <div key={server.id} className="mcp-settings-row">
              <CircleCheck size={18} className="mcp-status-enabled" />
              <div className="mcp-settings-info">
                <strong>{server.name}</strong>
                <span>{connectionText(server.config)}</span>
              </div>
              <small>{server.scope === 'project' ? '项目' : '全局'}</small>
            </div>
          ))}
          {(state?.disabled || []).map(id => (
            <div key={`disabled-${id}`} className="mcp-settings-row muted">
              <CircleOff size={18} />
              <div className="mcp-settings-info"><strong>{id}</strong><span>已禁用</span></div>
            </div>
          ))}
          {(state?.invalid || []).map(item => (
            <div key={`invalid-${item.id}`} className="mcp-settings-row muted">
              <AlertTriangle size={18} className="mcp-status-invalid" />
              <div className="mcp-settings-info"><strong>{item.id}</strong><span>{item.reason}</span></div>
            </div>
          ))}
          {!state?.servers?.length && !state?.disabled?.length && !state?.invalid?.length && (
            <div className="empty-state"><Server size={42} className="empty-icon" /><p>{t('settings.mcp.empty')}</p></div>
          )}
        </div>
      )}
    </div>
  );
}
