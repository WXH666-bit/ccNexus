import { useState, useEffect, useRef } from 'react';
import {
  Settings2,
  ChevronRight,
  Check,
  User,
  Server,
  Cpu,
  Radio,
  Brain,
  Wrench,
  X,
  RotateCcw,
  Square,
} from 'lucide-react';
import RefreshIcon from './RefreshIcon';
import { useTranslation } from 'react-i18next';
import {
  getAgents,
  getProcesses,
  getProviders,
  restartProcess,
  stopProcess,
  switchProvider,
} from '../utils/desktopBridgeApi';

interface Agent {
  id: string;
  name: string;
  description: string;
}

interface Provider {
  id: string;
  name: string;
  isActive?: boolean;
  isLocalProvider?: boolean;
  isCliLoginProvider?: boolean;
  base_url?: string;
}

interface Process {
  id: string;
  kind: 'DAEMON' | 'CHANNEL' | 'ORPHAN';
  provider?: string;
  pid: number;
  sessionId?: string;
  tabName?: string;
  uptime?: number;
  uptimeMs?: number;
  heapUsed?: number;
  activeRequestCount?: number;
}

interface ProcessTotals {
  daemon: number;
  channel: number;
  orphan: number;
  all: number;
}

interface Props {
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  streaming: boolean;
  onStreamingChange: (streaming: boolean) => void;
  alwaysThinking: boolean;
  onAlwaysThinkingChange: (thinking: boolean) => void;
  showToolAnchors: boolean;
  onShowToolAnchorsChange: (visible: boolean) => void;
  onProviderSwitch?: () => void;
}

type MenuState = 'closed' | 'main' | 'agents' | 'providers' | 'processes';

export default function ConfigSelect({
  selectedAgent,
  onAgentChange,
  streaming,
  onStreamingChange,
  alwaysThinking,
  onAlwaysThinkingChange,
  showToolAnchors,
  onShowToolAnchorsChange,
  onProviderSwitch,
}: Props) {
  const { t } = useTranslation();
  const [menuState, setMenuState] = useState<MenuState>('closed');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [currentProviderId, setCurrentProviderId] = useState<string | null>(null);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processTotals, setProcessTotals] = useState<ProcessTotals>({ daemon: 0, channel: 0, orphan: 0, all: 0 });
  const [processesLoading, setProcessesLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState('closed');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load agents
  useEffect(() => {
    if (menuState === 'agents') {
      getAgents()
        .then(data => setAgents(data.agents || []))
        .catch(() => setAgents([]));
    }
  }, [menuState]);

  // Load providers
  useEffect(() => {
    if (menuState === 'providers') {
      getProviders()
        .then(data => {
          setProviders(data.providers || []);
          setCurrentProviderId(data.currentProviderId || null);
        })
        .catch(() => setProviders([]));
    }
  }, [menuState]);

  const handleProviderSelect = async (providerId: string) => {
    try {
      const result = await switchProvider(providerId) as { changed?: boolean } | undefined;
      setCurrentProviderId(providerId);
      setProviders(previous => previous.map(provider => ({
        ...provider,
        isActive: provider.id === providerId,
      })));
      setMenuState('closed');
      window.dispatchEvent(new CustomEvent('ccnexus:provider-changed', {
        detail: { providerId, changed: result?.changed !== false },
      }));
      if (result?.changed !== false) onProviderSwitch?.();
    } catch (err) {
      console.error('Failed to switch provider:', err);
    }
  };

  const loadProcesses = async () => {
    setProcessesLoading(true);
    try {
      const data = await getProcesses() as { processes?: Process[]; totals?: ProcessTotals };
      setProcesses(data.processes || []);
      setProcessTotals(data.totals || { daemon: 0, channel: 0, orphan: 0, all: 0 });
    } catch {
      setProcesses([]);
      setProcessTotals({ daemon: 0, channel: 0, orphan: 0, all: 0 });
    } finally {
      setProcessesLoading(false);
    }
  };

  // ccgui keeps the node-process submenu live while it is open.
  useEffect(() => {
    if (menuState === 'main') {
      void loadProcesses();
      return undefined;
    }
    if (menuState !== 'processes') return undefined;
    void loadProcesses();
    const timer = window.setInterval(() => { void loadProcesses(); }, 2000);
    return () => window.clearInterval(timer);
  }, [menuState]);

  const handleKillProcess = async (proc: Process) => {
    if (proc.kind !== 'ORPHAN' && !window.confirm(`Terminate ${proc.kind.toLowerCase()} process ${proc.pid}?`)) return;
    try {
      await stopProcess({ pid: proc.pid, id: proc.id });
      // Refresh process list
      await loadProcesses();
    } catch (err) {
      console.error('Failed to kill process:', err);
    }
  };

  const handleRestartProcess = async (proc: Process) => {
    if (!window.confirm(`Restart daemon ${proc.pid}?`)) return;
    try {
      await restartProcess({ pid: proc.pid, id: proc.id });
      await loadProcesses();
    } catch (err) {
      console.error('Failed to restart process:', err);
    }
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const processGroups = {
    DAEMON: processes.filter(proc => proc.kind === 'DAEMON'),
    CHANNEL: processes.filter(proc => proc.kind === 'CHANNEL'),
    ORPHAN: processes.filter(proc => proc.kind === 'ORPHAN'),
  };

  const processKindLabel = (kind: Process['kind']) => {
    if (kind === 'DAEMON') return '守护进程';
    if (kind === 'CHANNEL') return '进行中对话';
    return '孤立进程';
  };

  const processTitle = (proc: Process) => {
    const prefix = proc.kind === 'DAEMON' ? 'Daemon' : proc.kind === 'CHANNEL' ? 'Channel' : 'Orphan';
    return proc.tabName ? `${prefix} · ${proc.tabName}` : prefix;
  };

  const providerLabel = (provider: Provider) => {
    if (provider.isLocalProvider) return t('config.localSettingsProvider');
    if (provider.isCliLoginProvider) return t('config.cliLoginProvider');
    return provider.name;
  };

  const renderProcessGroup = (kind: Process['kind'], items: Process[]) => {
    if (items.length === 0) return null;
    return (
      <div className="process-group" key={kind}>
        <div className={`process-group-title ${kind === 'ORPHAN' ? 'danger' : ''}`}>
          <Cpu size={13} />
          <span>{processKindLabel(kind)} ({items.length})</span>
        </div>
        {items.map(proc => (
          <div key={proc.id} className={`process-row ${proc.kind === 'ORPHAN' ? 'orphan' : ''}`}>
            <Cpu size={15} className="process-row-icon" />
            <div className="process-info">
              <div className="process-title">{processTitle(proc)}</div>
              <div className="process-meta">
                PID {proc.pid} · {formatUptime(proc.uptimeMs ?? proc.uptime ?? 0)}
                {proc.activeRequestCount ? ` · ${proc.activeRequestCount} active` : ''}
              </div>
            </div>
            {proc.kind === 'DAEMON' && (
              <button className="process-icon-btn" title="重启" onClick={() => handleRestartProcess(proc)}>
                <RotateCcw size={14} />
              </button>
            )}
            <button className="process-icon-btn danger" title={proc.kind === 'CHANNEL' ? '中断' : t('config.kill')} onClick={() => handleKillProcess(proc)}>
              <Square size={13} />
            </button>
          </div>
        ))}
      </div>
    );
  };

  const toggleMenu = () => {
    setMenuState(menuState === 'closed' ? 'main' : 'closed');
  };

  const handleToolAnchorsChange = (visible: boolean) => {
    onShowToolAnchorsChange(visible);
    localStorage.setItem('showToolAnchors', String(visible));
  };

  return (
    <div className="config-select" ref={menuRef}>
      <button className="config-btn" onClick={toggleMenu} title={t('config.title')}>
        <Settings2 size={16} />
      </button>

      {menuState !== 'closed' && (
        <div className="config-menu">
          {menuState === 'main' && (
            <>
              <div className="config-menu-header">
                <span>{t('config.title')}</span>
                <button className="close-btn" onClick={() => setMenuState('closed')}>
                  <X size={14} />
                </button>
              </div>
              <div className="config-menu-items">
                <button className="config-menu-item" onClick={() => setMenuState('agents')}>
                  <User size={16} />
                  <span>{t('config.agent')}</span>
                  <ChevronRight size={14} />
                </button>
                <button className="config-menu-item" onClick={() => setMenuState('providers')}>
                  <Server size={16} />
                  <span>{t('config.switchProvider', { defaultValue: '切换当前供应商' })}</span>
                  <ChevronRight size={14} />
                </button>
                <button className="config-menu-item" onClick={() => setMenuState('processes')}>
                  <Cpu size={16} />
                  <span>{t('config.processes')}</span>
                  {processTotals.all > 0 && (
                    <span className={`process-count-badge ${processTotals.orphan > 0 ? 'danger' : ''}`}>
                      {processTotals.all} 个进程
                    </span>
                  )}
                  <ChevronRight size={14} />
                </button>
                <div className="config-menu-item toggle-item">
                  <Radio size={16} />
                  <span>{t('config.streaming')}</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={streaming}
                      onChange={e => onStreamingChange(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="config-menu-item toggle-item">
                  <Brain size={16} />
                  <span>{t('config.thinking')}</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={alwaysThinking}
                      onChange={e => onAlwaysThinkingChange(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="config-menu-item toggle-item">
                  <Wrench size={16} />
                  <span>{t('config.showToolAnchors')}</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={showToolAnchors}
                      onChange={e => handleToolAnchorsChange(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </>
          )}

          {menuState === 'agents' && (
            <>
              <div className="config-menu-header">
                <button className="back-btn" onClick={() => setMenuState('main')}>←</button>
                <span>{t('config.agent')}</span>
              </div>
              <div className="config-menu-items">
                <button
                  className={`config-menu-item ${!selectedAgent ? 'active' : ''}`}
                  onClick={() => { onAgentChange(''); setMenuState('closed'); }}
                >
                  {t('config.noAgent')}
                </button>
                {agents.map(agent => (
                  <button
                    key={agent.id}
                    className={`config-menu-item ${selectedAgent === agent.id ? 'active' : ''}`}
                    onClick={() => { onAgentChange(agent.id); setMenuState('closed'); }}
                  >
                    <div className="agent-info">
                      <div className="agent-name">{agent.name}</div>
                      <div className="agent-desc">{agent.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {menuState === 'providers' && (
            <>
              <div className="config-menu-header">
                <button className="back-btn" onClick={() => setMenuState('main')}>←</button>
                <span>{t('config.switchProvider', { defaultValue: '切换当前供应商' })}</span>
              </div>
              <div className="config-menu-items">
                {providers.length === 0 ? (
                  <div className="config-menu-item disabled">{t('config.noProviders')}</div>
                ) : providers.map(provider => (
                  <button
                    key={provider.id}
                    className={`config-menu-item ${provider.id === currentProviderId || provider.isActive ? 'active' : ''}`}
                    onClick={() => void handleProviderSelect(provider.id)}
                  >
                    <Server size={16} />
                    <span className="provider-menu-name">{providerLabel(provider)}</span>
                    {(provider.id === currentProviderId || provider.isActive) && <Check size={15} />}
                  </button>
                ))}
              </div>
            </>
          )}

          {menuState === 'processes' && (
            <>
              <div className="config-menu-header">
                <button className="back-btn" onClick={() => setMenuState('main')}>←</button>
                <span>{t('config.processes')}</span>
                <button className="process-refresh-btn" onClick={() => loadProcesses()} title="刷新">
                  <RefreshIcon size={14} spinning={processesLoading} />
                </button>
              </div>
              <div className="config-menu-items process-menu-items">
                <div className="process-summary">共 {processTotals.all} 个 · 孤立 {processTotals.orphan} 个</div>
                {processes.length === 0 ? (
                  <div className="empty-state">{t('config.noProcesses')}</div>
                ) : (
                  <>
                    {renderProcessGroup('DAEMON', processGroups.DAEMON)}
                    {renderProcessGroup('CHANNEL', processGroups.CHANNEL)}
                    {renderProcessGroup('ORPHAN', processGroups.ORPHAN)}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
