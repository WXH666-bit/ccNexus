import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Wrench } from 'lucide-react';
import type { ToolResultBlock, ToolUseBlock } from '../../types';
import { normalizeToolName } from '../../utils/toolRendering.js';
import { normalizeToolInput } from '../../utils/toolInputNormalization.js';

interface Props {
  block: ToolUseBlock;
  result?: ToolResultBlock | null;
}

function resultText(result?: ToolResultBlock | null): string {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) {
    return result.content.map(item => {
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text ?? '');
      }
      return typeof item === 'string' ? item : '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

const OMIT_SUMMARY_FIELDS = new Set([
  'file_path',
  'filePath',
  'path',
  'target_file',
  'targetFile',
  'notebook_path',
  'command',
  'cmd',
  'workdir',
]);

const MAX_PARAM_VALUE_CHARS = 4000;

function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function formatParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatParamValueCapped(value: unknown): string {
  const text = formatParamValue(value);
  if (text.length <= MAX_PARAM_VALUE_CHARS) return text;
  return `${text.slice(0, MAX_PARAM_VALUE_CHARS)}... (+${text.length - MAX_PARAM_VALUE_CHARS} more chars)`;
}

function getToolDisplayName(name: string): string {
  const normalizedName = normalizeToolName(name);
  if (normalizedName === 'write' || normalizedName === 'write_file' || normalizedName === 'write_to_file' || normalizedName === 'create_file') {
    return '写入文件';
  }
  if (normalizedName === 'apply_patch') return '应用补丁';
  return name;
}

export default function GenericToolBlock({ block, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const name = block.name;
  const normalizedInput = normalizeToolInput(name, block.input) ?? block.input;
  const normalizedName = normalizeToolName(name);
  const output = resultText(result);
  const filePath =
    (typeof normalizedInput.file_path === 'string' ? normalizedInput.file_path : undefined) ||
    (typeof normalizedInput.path === 'string' ? normalizedInput.path : undefined);
  const displayName = getToolDisplayName(name);
  const isWriteTool = normalizedName === 'write' || normalizedName === 'write_file' || normalizedName === 'write_to_file' || normalizedName === 'create_file';
  const otherParams = Object.entries(block.input).filter(([key]) => !OMIT_SUMMARY_FIELDS.has(key));
  const hasBody = otherParams.length > 0 || Boolean(output);
  const statusClass = result ? (result.is_error ? 'error' : 'success') : 'running';
  const writeContent = isWriteTool && typeof normalizedInput.content === 'string' ? normalizedInput.content : '';
  const writeLineCount = countLines(writeContent);

  return (
    <div className="tool-block generic-block">
      <div className="tool-block-header" onClick={() => hasBody && setExpanded(!expanded)}>
        <span className="tool-icon">{isWriteTool ? <Pencil size={14} /> : <Wrench size={14} />}</span>
        <span className="tool-label">{displayName}</span>
        {filePath && <span className="file-link">{getFileName(filePath)}</span>}
        {isWriteTool && writeLineCount > 0 && (
          <span className="diff-stats">
            <span className="stat-add">+{writeLineCount}</span>
            <span className="stat-del">-0</span>
          </span>
        )}
        <span className={`status-dot ${statusClass}`} />
        {hasBody && <span className="expand-icon">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
      </div>
      {expanded && hasBody && (
        <div className="tool-block-body">
          {otherParams.map(([key, value]) => (
            <div className="task-field" key={key}>
              <div className="task-field-label">{key}</div>
              <pre className="task-field-content">{formatParamValueCapped(value)}</pre>
            </div>
          ))}
          {output && (
            <div className="task-field">
              <div className="task-field-label">Result</div>
              <pre className="task-field-content">{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
