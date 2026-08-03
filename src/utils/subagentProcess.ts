import type { SubagentHistoryResponse } from '../types';

export interface SubagentProcessModel {
  notes: string[];
  readFiles: string[];
  toolCalls: Array<{ id: string; name: string; detail?: string }>;
}

export function formatSubagentDuration(totalDurationMs?: number): string | null {
  if (typeof totalDurationMs !== 'number' || !Number.isFinite(totalDurationMs)) return null;
  if (totalDurationMs < 1000) return `${Math.max(0, Math.round(totalDurationMs))}ms`;
  return `${(totalDurationMs / 1000).toFixed(1)}s`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getRawContent(message: unknown): unknown[] {
  const record = asRecord(message);
  const nested = asRecord(record.message);
  const content = nested.content ?? record.content;
  return Array.isArray(content) ? content : [];
}

function getToolDetail(input: unknown): string | undefined {
  const record = asRecord(input);
  const value = record.file_path ?? record.path ?? record.command ?? record.cmd ?? record.pattern;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compactPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.length > 4 ? `.../${parts.slice(-4).join('/')}` : filePath;
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

export function buildSubagentProcessModel(history?: SubagentHistoryResponse): SubagentProcessModel {
  const model: SubagentProcessModel = { notes: [], readFiles: [], toolCalls: [] };
  if (!history?.success || !Array.isArray(history.messages)) return model;

  history.messages.forEach((message, messageIndex) => {
    const record = asRecord(message);
    getRawContent(message).forEach((block, blockIndex) => {
      const item = asRecord(block);
      if (item.type === 'text' && record.type === 'assistant' && typeof item.text === 'string' && item.text.trim()) {
        model.notes.push(item.text.trim());
        return;
      }
      if (item.type !== 'tool_use') return;

      const name = typeof item.name === 'string' && item.name.trim() ? item.name : 'Tool';
      const detail = getToolDetail(item.input);
      if (name.toLowerCase() === 'read' && detail) {
        pushUnique(model.readFiles, compactPath(detail));
        return;
      }
      model.toolCalls.push({
        id: `${messageIndex}-${blockIndex}`,
        name,
        detail: detail ? compactPath(detail) : undefined,
      });
    });
  });

  return model;
}
