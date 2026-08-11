import { useState } from 'react';
import { Terminal } from 'lucide-react';
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

function getStringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getCommandSummary(input: ToolUseBlock['input']): string {
  const description = getStringInput(input.description);
  if (description) return description;

  const command = getStringInput(input.command) || getStringInput(input._partialInput);
  return command.split(/\r?\n/).find(Boolean)?.trim() || 'Shell command';
}

export default function BashToolBlock({ block, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const command = (block.input.command as string) || (block.input._partialInput as string) || '';
  const commandSummary = getCommandSummary(block.input);
  const output = resultText(result);
  const statusClass = result ? (result.is_error ? 'error' : 'success') : 'running';

  return (
    <div className="tool-block bash-block">
      <div
        className={`tool-block-header ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="tool-icon"><Terminal size={14} /></span>
        <span className="tool-label">运行命令</span>
        <span className="tool-summary" title={commandSummary}>{commandSummary}</span>
        <span className={`status-dot ${statusClass}`} />
      </div>
      <div
        className={`tool-block-body ${expanded ? 'is-open' : ''}`}
        aria-hidden={!expanded}
      >
        <div className="tool-block-body-inner">
          <pre className="command-text">{command}</pre>
          {output && <pre className={`command-output ${result?.is_error ? 'error' : ''}`}>{output}</pre>}
        </div>
      </div>
    </div>
  );
}
