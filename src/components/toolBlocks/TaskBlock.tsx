import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ToolUseBlock } from '../../types';

interface Props { block: ToolUseBlock }

export default function TaskBlock({ block }: Props) {
  const [expanded, setExpanded] = useState(false);
  const description = (block.input.description as string) || (block.input.prompt as string) || '子代理任务';
  const status = (block.input.status as string) || 'running';
  
  const statusIcon = status === 'completed' ? <CheckCircle2 size={14} className="status-success" /> 
    : status === 'error' ? <XCircle size={14} className="status-error" />
    : <Loader2 size={14} className="status-running" />;

  return (
    <div className={`tool-block task-block task-${status}`}>
      <div className="tool-block-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon"><Bot size={14} /></span>
        <span className="tool-label">子代理</span>
        {statusIcon}
        <span className="task-desc">{description.slice(0, 80)}{description.length > 80 ? '...' : ''}</span>
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <div className="tool-block-body">
          <div className="task-details">
            <div className="task-detail-row">
              <span className="task-detail-label">描述:</span>
              <span className="task-detail-value">{description}</span>
            </div>
            <div className="task-detail-row">
              <span className="task-detail-label">状态:</span>
              <span className={`task-detail-value task-status-${status}`}>{status}</span>
            </div>
            {block.input.prompt != null && (
              <div className="task-detail-row">
                <span className="task-detail-label">提示:</span>
                <pre className="task-prompt">{String(block.input.prompt)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
