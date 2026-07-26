import { useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';

interface Props {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
}

function resultText(result?: ToolResultBlock | null): string {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) {
    return result.content.map(item => {
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text ?? '');
      }
      return typeof item === 'string' ? item : '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

export default function TaskBlock({ block, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const description =
    (block.input.description as string) ||
    (block.input.prompt as string) ||
    'Subtask';
  const status = result ? (result.is_error ? 'error' : 'completed') : 'running';
  const output = resultText(result);

  const statusIcon = status === 'completed'
    ? <CheckCircle2 size={14} className="status-success" />
    : status === 'error'
      ? <XCircle size={14} className="status-error" />
      : <Loader2 size={14} className="status-running" />;

  return (
    <div className={`tool-block task-block task-${status}`}>
      <div className="tool-block-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon"><Bot size={14} /></span>
        <span className="tool-label">Subtask</span>
        {statusIcon}
        <span className="task-desc">{description.slice(0, 80)}{description.length > 80 ? '...' : ''}</span>
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <div className="tool-block-body">
          <div className="task-details">
            <div className="task-detail-row">
              <span className="task-detail-label">Description:</span>
              <span className="task-detail-value">{description}</span>
            </div>
            <div className="task-detail-row">
              <span className="task-detail-label">Status:</span>
              <span className={`task-detail-value task-status-${status}`}>{status}</span>
            </div>
            {block.input.prompt != null && (
              <div className="task-detail-row">
                <span className="task-detail-label">Prompt:</span>
                <pre className="task-prompt">{String(block.input.prompt)}</pre>
              </div>
            )}
            {output && (
              <div className="task-detail-row">
                <span className="task-detail-label">Result:</span>
                <pre className={`task-prompt ${result?.is_error ? 'error' : ''}`}>{output}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
