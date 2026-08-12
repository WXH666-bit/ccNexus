import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';
import EditToolBlock from './EditToolBlock';
import BashToolBlock from './BashToolBlock';
import ReadToolBlock from './ReadToolBlock';
import GenericToolBlock from './GenericToolBlock';
import {
  BASH_TOOL_NAMES,
  EDIT_TOOL_NAMES,
  READ_TOOL_NAMES,
  isToolName,
} from '../../utils/toolRendering.js';

interface Props {
  name: string;
  blocks: ToolUseBlock[];
  getResult?: (toolId: string | undefined) => ToolResultBlock | null;
  isStreaming?: boolean;
}

function getToolLabel(name: string) {
  if (isToolName(name, EDIT_TOOL_NAMES)) return 'Edit';
  if (isToolName(name, BASH_TOOL_NAMES)) return 'Bash';
  if (isToolName(name, READ_TOOL_NAMES)) return 'Read';
  return name;
}

function renderBlock(block: ToolUseBlock, result?: ToolResultBlock | null, isStreaming = false) {
  if (isToolName(block.name, EDIT_TOOL_NAMES)) return <EditToolBlock block={block} result={result} />;
  if (isToolName(block.name, BASH_TOOL_NAMES)) return <BashToolBlock block={block} result={result} isStreaming={isStreaming} />;
  if (isToolName(block.name, READ_TOOL_NAMES)) return <ReadToolBlock block={block} result={result} />;
  return <GenericToolBlock block={block} result={result} isStreaming={isStreaming} />;
}

export default function ToolGroupBlock({ name, blocks, getResult, isStreaming = false }: Props) {
  const [expanded, setExpanded] = useState(isStreaming);

  useEffect(() => {
    setExpanded(isStreaming);
  }, [isStreaming]);

  return (
    <div className={`tool-group-block ${isStreaming ? 'is-live' : ''}`}>
      <div className="tool-group-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="tool-group-label">{getToolLabel(name)}</span>
        <span className="tool-group-count">x{blocks.length}</span>
      </div>
      {expanded && (
        <div className="tool-group-body">
          {blocks.map((block, i) => (
            <div key={block.id || i} className="group-item">
              {renderBlock(block, getResult?.(block.id), isStreaming)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
