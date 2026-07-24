import { Terminal } from 'lucide-react';
import type { ToolUseBlock } from '../../types';

interface Props { block: ToolUseBlock }

export default function BashToolBlock({ block }: Props) {
  const command = (block.input.command as string) || (block.input._partialInput as string) || '';
  return (
    <div className="tool-block bash-block">
      <div className="tool-block-header">
        <span className="tool-icon"><Terminal size={14} /></span>
        <span className="tool-label">Bash</span>
      </div>
      <div className="tool-block-body">
        <pre className="command-text">{command}</pre>
      </div>
    </div>
  );
}
