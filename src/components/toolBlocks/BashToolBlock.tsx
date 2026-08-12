import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';

interface Props {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
  isStreaming?: boolean;
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

function getCommandSummary(input: ToolUseBlock['input'], partialCommand?: string, hasPartialInput = false): string {
  const description = getStringInput(input.description);
  if (description) return description;

  const command = getStringInput(input.command) || getStringInput(partialCommand);
  if (command) return command.split(/\r?\n/).find(Boolean)?.trim() || 'Shell command';
  return hasPartialInput ? '正在准备命令…' : '正在准备参数…';
}

export default function BashToolBlock({ block, result, isStreaming = false }: Props) {
  const [expanded, setExpanded] = useState(isStreaming);
  const partialCommand = getStringInput(block._partialCommand);
  const command = (block.input.command as string) || partialCommand;
  const commandSummary = getCommandSummary(block.input, partialCommand, Boolean(block._partialInput));
  const output = resultText(result);
  const statusClass = result ? (result.is_error ? 'error' : 'success') : 'running';

  useEffect(() => {
    if (isStreaming) setExpanded(true);
  }, [isStreaming]);

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
          <pre className="command-text">{command || '正在准备命令…'}</pre>
          {output && <pre className={`command-output ${result?.is_error ? 'error' : ''}`}>{output}</pre>}
        </div>
      </div>
    </div>
  );
}
