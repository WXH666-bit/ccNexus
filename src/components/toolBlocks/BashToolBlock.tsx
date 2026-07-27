import { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';

interface Props {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
}

function resultText(result?: ToolResultBlock | null): string {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .map(item => {
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '');
        }
        return typeof item === 'string' ? item : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export default function BashToolBlock({ block, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const command = (block.input.command as string) || (block.input._partialInput as string) || '';
  const output = resultText(result);
  const statusClass = result ? (result.is_error ? 'error' : 'success') : 'running';

  return (
    <div className="tool-block bash-block">
      <div
        className={`tool-block-header ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="tool-icon"><Terminal size={14} /></span>
        <span className="tool-label">Bash</span>
        <span className={`status-dot ${statusClass}`} />
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <div className="tool-block-body">
          <pre className="command-text">{command}</pre>
          {output && <pre className={`command-output ${result?.is_error ? 'error' : ''}`}>{output}</pre>}
        </div>
      )}
    </div>
  );
}
