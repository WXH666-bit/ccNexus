import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolUseBlock } from '../../types';
import EditToolBlock from './EditToolBlock';
import BashToolBlock from './BashToolBlock';
import ReadToolBlock from './ReadToolBlock';
import GenericToolBlock from './GenericToolBlock';

interface Props {
  name: string;
  blocks: ToolUseBlock[];
}

function getToolIcon(name: string) {
  switch (name) {
    case 'Edit': case 'MultiEdit': return '编辑';
    case 'Bash': return 'Bash';
    case 'Read': case 'ReadFile': return '读取';
    default: return name;
  }
}

function renderBlock(block: ToolUseBlock) {
  switch (block.name) {
    case 'Edit': case 'MultiEdit': return <EditToolBlock block={block} />;
    case 'Bash': return <BashToolBlock block={block} />;
    case 'Read': case 'ReadFile': return <ReadToolBlock block={block} />;
    default: return <GenericToolBlock block={block} />;
  }
}

export default function ToolGroupBlock({ name, blocks }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-group-block">
      <div className="tool-group-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="tool-group-label">{getToolIcon(name)}</span>
        <span className="tool-group-count">×{blocks.length}</span>
      </div>
      {expanded && (
        <div className="tool-group-body">
          {blocks.map((block, i) => (
            <div key={block.id || i} className="group-item">
              {renderBlock(block)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
