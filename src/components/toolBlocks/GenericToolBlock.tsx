import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
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

export default function GenericToolBlock({ block, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const name = block.name;
  const output = resultText(result);
  const inputStr = Object.keys(block.input).length > 0
    ? JSON.stringify(block.input, null, 2)
    : '';
  const body = [inputStr, output && `Result:\n${output}`].filter(Boolean).join('\n\n');

  return (
    <div className="tool-block generic-block">
      <div className="tool-block-header" onClick={() => body && setExpanded(!expanded)}>
        <span className="tool-icon"><Wrench size={14} /></span>
        <span className="tool-label">{name}</span>
        {result && <span className={`status-dot ${result.is_error ? 'error' : 'success'}`} />}
        {body && <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
      </div>
      {expanded && body && (
        <div className="tool-block-body">
          <pre className="input-json">{body}</pre>
        </div>
      )}
    </div>
  );
}
