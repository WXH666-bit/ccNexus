import { useState, useEffect, useRef } from 'react';
import { Settings2, ChevronRight, User, Server, Cpu, Radio, Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Agent {
  id: string;
  name: string;
  description: string;
}

interface Provider {
  id: string;
  name: string;
  base_url?: string;
}

interface Process {
  pid: number;
  sessionId: string;
  startTime: number;
  uptime: number;
}

interface Props {
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  streaming: boolean;
  onStreamingChange: (streaming: boolean) => void;
  alwaysThinking: boolean;
  onAlwaysThinkingChange: (thinking: boolean) => void;
}

type MenuState = 'closed' | 'main' | 'agents' | 'providers' | 'processes';

export default function ConfigSelect({
  selectedAgent,
  onAgentChange,
  streaming,
  onStreamingChange,
  alwaysThinking,
  onAlwaysThinkingChange,
}: Props) {
  const { t } = useTranslation();
  const [menuState, setMenuState] = useState<MenuState>('closed');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
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
      fetch('/api/agents')
        .then(r => r.json())
        .then(data => setAgents(data.agents || []))
        .catch(() => setAgents([]));
    }
  }, [menuState]);

  // Load providers
  useEffect(() => {
    if (menuState === 'providers') {
      fetch('/api/providers')
        .then(r => r.json())
        .then(data => setProviders(data.providers || []))
        .catch(() => setProviders([]));
    }
  }, [menuState]);

  // Load processes
  useEffect(() => {
    if (menuState === 'processes') {
      fetch('/api/processes')
        .then(r => r.json())
        .then(data => setProcesses(data.processes || []))
        .catch(() => setProcesses([]));
    }
  }, [menuState]);

  const handleKillProcess = async (pid: number) => {
    try {
      await fetch(`/api/processes/${pid}/kill`, { method: 'POST' });
      // Refresh process list
      const data = await fetch('/api/processes').then(r => r.json());
      setProcesses(data.processes || []);
    } catch (err) {
      console.error('Failed to kill process:', err);
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

  const toggleMenu = () => {
    setMenuState(menuState === 'closed' ? 'main' : 'closed');
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
                  <span>{t('config.provider')}</span>
                  <ChevronRight size={14} />
                </button>
                <button className="config-menu-item" onClick={() => setMenuState('processes')}>
                  <Cpu size={16} />
                  <span>{t('config.processes')}</span>
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
                <span>{t('config.provider')}</span>
              </div>
              <div className="config-menu-items">
                {providers.map(provider => (
                  <button
                    key={provider.id}
                    className="config-menu-item"
                    onClick={async () => {
                      await fetch(`/api/providers/switch/${provider.id}`, { method: 'POST' });
                      setMenuState('closed');
                      window.location.reload();
                    }}
                  >
                    {provider.name}
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
              </div>
              <div className="config-menu-items">
                {processes.length === 0 ? (
                  <div className="empty-state">{t('config.noProcesses')}</div>
                ) : (
                  processes.map(proc => (
                    <div key={proc.pid} className="config-menu-item process-item">
                      <div className="process-info">
                        <div className="process-pid">PID: {proc.pid}</div>
                        <div className="process-uptime">{formatUptime(proc.uptime)}</div>
                      </div>
                      <button className="kill-btn" onClick={() => handleKillProcess(proc.pid)}>
                        {t('config.kill')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
