import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { SubAgentInfo } from '../../types';

interface Props {
  agents: SubAgentInfo[];
  title?: string;
}

function getStatusIcon(status: SubAgentInfo['status']) {
  switch (status) {
    case 'running': return <Loader2 size={12} className="agent-status-running" />;
    case 'completed': return <CheckCircle2 size={12} className="agent-status-completed" />;
    case 'error': return <XCircle size={12} className="agent-status-error" />;
    default: return <span className="agent-status-idle">●</span>;
  }
}

export default function AgentGroupBlock({ agents, title }: Props) {
  const [expanded, setExpanded] = useState(false);
  
  const runningCount = agents.filter(a => a.status === 'running').length;
  const completedCount = agents.filter(a => a.status === 'completed').length;
  const errorCount = agents.filter(a => a.status === 'error').length;

  return (
    <div className="agent-group-block">
      <div className="agent-group-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <Bot size={14} className="agent-group-icon" />
        <span className="agent-group-title">{title || '子代理组'}</span>
        <div className="agent-group-stats">
          {runningCount > 0 && <span className="agent-stat running">{runningCount} 运行中</span>}
          {completedCount > 0 && <span className="agent-stat completed">{completedCount} 完成</span>}
          {errorCount > 0 && <span className="agent-stat error">{errorCount} 错误</span>}
        </div>
        <span className="agent-group-count">{agents.length}</span>
      </div>
      {expanded && (
        <div className="agent-group-body">
          {agents.map((agent, i) => (
            <div key={agent.id || i} className="agent-item">
              {getStatusIcon(agent.status)}
              <span className="agent-name">{agent.name}</span>
              {agent.description && (
                <span className="agent-desc">{agent.description.slice(0, 60)}{agent.description.length > 60 ? '...' : ''}</span>
              )}
              {agent.progress !== undefined && (
                <div className="agent-progress">
                  <div className="agent-progress-bar" style={{ width: `${agent.progress}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
