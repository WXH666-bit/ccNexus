import { useState, useEffect } from 'react';
import { X, Check, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAgents } from '../utils/desktopBridgeApi';

interface Agent {
  name: string;
  description?: string;
  tools?: string[];
  model?: string;
  enabled?: boolean;
}

interface AgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAgent: string | null;
  onSelectAgent: (agent: string | null) => void;
}

export default function AgentDialog({ isOpen, onClose, selectedAgent, onSelectAgent }: AgentDialogProps) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAgents();
    }
  }, [isOpen]);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await getAgents();
      setAgents(data.agents || []);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (agentName: string) => {
    if (selectedAgent === agentName) {
      onSelectAgent(null);
    } else {
      onSelectAgent(agentName);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="agent-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="agent-dialog-header">
          <h3>{t('agent.title', 'Agent Management')}</h3>
          <button className="dialog-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="agent-dialog-content">
          {loading ? (
            <div className="agent-loading">{t('common.loading', 'Loading...')}</div>
          ) : agents.length === 0 ? (
            <div className="agent-empty">{t('agent.empty', 'No agents available')}</div>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => (
                <div
                  key={agent.name}
                  className={`agent-item ${selectedAgent === agent.name ? 'selected' : ''}`}
                  onClick={() => handleSelect(agent.name)}
                >
                  <div className="agent-item-icon">
                    <User size={20} />
                  </div>
                  <div className="agent-item-info">
                    <div className="agent-item-name">{agent.name}</div>
                    {agent.description && (
                      <div className="agent-item-desc">{agent.description}</div>
                    )}
                    {agent.tools && agent.tools.length > 0 && (
                      <div className="agent-item-tools">
                        {agent.tools.slice(0, 3).join(', ')}
                        {agent.tools.length > 3 && ` +${agent.tools.length - 3}`}
                      </div>
                    )}
                    {agent.model && (
                      <div className="agent-item-model">{agent.model}</div>
                    )}
                  </div>
                  {selectedAgent === agent.name && (
                    <div className="agent-item-check">
                      <Check size={16} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
