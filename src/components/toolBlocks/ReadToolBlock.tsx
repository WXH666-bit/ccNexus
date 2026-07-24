import { FileText } from 'lucide-react';
import type { ToolUseBlock } from '../../types';

interface Props { block: ToolUseBlock }

export default function ReadToolBlock({ block }: Props) {
  const filePath = (block.input.file_path as string) || (block.input.path as string) || 'unknown';
  return (
    <div className="tool-block read-block">
      <div className="tool-block-header">
        <span className="tool-icon"><FileText size={14} /></span>
        <span className="tool-label">读取文件</span>
        <span className="file-link">{filePath}</span>
      </div>
    </div>
  );
}
