import { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAgents } from '../../utils/desktopBridgeApi';

interface Agent {
  id: string;
  name: string;
  description?: string;
  file?: string;
}

export default function AgentSection() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAgents() as { agents?: Agent[] };
      setAgents(Array.isArray(result.agents) ? result.agents : []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  return (
    <div className="settings-section-content">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.agents.title')}</h3>
          <p className="settings-desc">{t('settings.agents.desc')}</p>
        </div>
        <button className="icon-button" onClick={() => void loadAgents()} disabled={loading} title={t('common.refresh', { defaultValue: 'Refresh' })}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : agents.length === 0 ? (
        <div className="empty-state">
          <Bot size={42} className="empty-icon" />
          <p>{t('settings.agents.empty')}</p>
        </div>
      ) : (
        <div className="agent-list settings-agent-list">
          {agents.map(agent => (
            <div key={agent.id} className="agent-settings-row">
              <Bot size={18} />
              <div className="agent-info">
                <strong>{agent.name}</strong>
                <span>{agent.description || agent.file || agent.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
