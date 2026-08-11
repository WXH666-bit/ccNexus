import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';
import { computeDiff, computeDiffStats } from '../../utils/diff';

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

  const diffStats = useMemo(() => computeDiffStats(oldStr, newStr), [oldStr, newStr]);
  const hasBody = Boolean(oldStr || newStr);
  const diffPreview = useMemo(
    () => expanded && hasBody ? computeDiff(oldStr, newStr) : null,
    [expanded, oldStr, newStr],
  );

  return (
    <div className="tool-block edit-block">
      <div className="tool-block-header" onClick={() => hasBody && setExpanded(!expanded)}>
        <span className="tool-icon"><Pencil size={14} /></span>
        <span className="tool-label">编辑文件</span>
        <span className="file-link">{filePath}</span>
        {(diffStats.additions > 0 || diffStats.deletions > 0) && (
          <span className="diff-stats">
            <span className="stat-add">+{diffStats.additions}</span>
            <span className="stat-del">-{diffStats.deletions}</span>
          </span>
        )}
        <span className={`status-dot ${statusClass}`} />
        {hasBody && <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
      </div>
      {hasBody && (
        <div
          className={`tool-block-body ${expanded ? 'is-open' : ''}`}
          aria-hidden={!expanded}
        >
          <div className="tool-block-body-inner">
            {diffPreview && (diffPreview.truncated ? (
              <div className="diff-preview-summary">Diff is too large to render here; open the file to inspect the full change.</div>
            ) : (
              <div className="diff-view" dangerouslySetInnerHTML={{ __html: diffPreview.html }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
