import { FileText } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';

interface Props {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
}

export default function ReadToolBlock({ block, result }: Props) {
  const filePath = (block.input.file_path as string) || (block.input.path as string) || 'unknown';
  const statusClass = result ? (result.is_error ? 'error' : 'success') : 'running';

  return (
    <div className="tool-block read-block">
      <div className="tool-block-header">
        <span className="tool-icon"><FileText size={14} /></span>
        <span className="tool-label">Read file</span>
        <span className="file-link">{filePath}</span>
        <span className={`status-dot ${statusClass}`} />
      </div>
    </div>
  );
}
