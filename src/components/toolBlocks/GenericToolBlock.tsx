import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { ToolUseBlock } from '../../types';

interface Props { block: ToolUseBlock }

export default function GenericToolBlock({ block }: Props) {
  const [expanded, setExpanded] = useState(false);
  const name = block.name;
  const inputStr = Object.keys(block.input).length > 0
    ? JSON.stringify(block.input, null, 2)
    : '';

  return (
    <div className="tool-block generic-block">
      <div className="tool-block-header" onClick={() => inputStr && setExpanded(!expanded)}>
        <span className="tool-icon"><Wrench size={14} /></span>
        <span className="tool-label">{name}</span>
        {inputStr && <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
      </div>
      {expanded && inputStr && (
        <div className="tool-block-body">
          <pre className="input-json">{inputStr}</pre>
        </div>
      )}
    </div>
  );
}
