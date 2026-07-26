import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';
import { computeDiff } from '../../utils/diff';

interface Props {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
}

export default function EditToolBlock({ block, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const input = block.input;
  const filePath = (input.file_path as string) || (input.path as string) || 'unknown';
  const oldStr = (input.old_string as string) || '';
  const newStr = (input.new_string as string) || '';
  const statusClass = result ? (result.is_error ? 'error' : 'success') : 'running';

  let additions = 0, deletions = 0;
  if (oldStr || newStr) {
    const diff = computeDiff(oldStr, newStr);
    additions = diff.additions;
    deletions = diff.deletions;
  }

  const diffHtml = (oldStr || newStr) ? computeDiff(oldStr, newStr).html : '';

  return (
    <div className="tool-block edit-block">
      <div className="tool-block-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon"><Pencil size={14} /></span>
        <span className="tool-label">编辑文件</span>
        <span className="file-link">{filePath}</span>
        {(additions > 0 || deletions > 0) && (
          <span className="diff-stats">
            <span className="stat-add">+{additions}</span>
            <span className="stat-del">-{deletions}</span>
          </span>
        )}
        <span className={`status-dot ${statusClass}`} />
        <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && diffHtml && (
        <div className="tool-block-body">
          <div className="diff-view" dangerouslySetInnerHTML={{ __html: diffHtml }} />
        </div>
      )}
    </div>
  );
}
