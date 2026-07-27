import fs from 'node:fs/promises';
import path from 'node:path';

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function textBlock(text) {
  return { type: 'text', text: text ?? '' };
}

function normalizeToolResultContent(content) {
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

function normalizeContent(content) {
  if (typeof content === 'string') return [textBlock(content)];
  if (!Array.isArray(content)) return [];

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return null;
      if (block.type === 'text') return textBlock(block.text);
      if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking ?? '' };
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id ?? '',
          name: block.name ?? '',
          input: block.input && typeof block.input === 'object' ? block.input : {},
        };
      }
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: normalizeToolResultContent(block.content),
          is_error: Boolean(block.is_error),
        };
      }
      if (block.type === 'image') return block;
      return null;
    })
    .filter(Boolean);
}

function roleFromEntry(entry, content) {
  const messageRole = entry?.message?.role;
  if (messageRole === 'assistant') return 'assistant';
  if (messageRole === 'system') return 'system';
  if (content.length > 0 && content.every((block) => block.type === 'tool_result')) {
    return 'assistant';
  }
  return 'user';
}

export function convertClaudeHistoryEntry(entry, fallbackSessionId) {
  if (!entry?.message || entry.isSidechain) return null;

  const content = normalizeContent(entry.message.content);
  if (content.length === 0) return null;

  const role = roleFromEntry(entry, content);
  const message = {
    id: entry.uuid || entry.message.id || `${role}-${toTimestamp(entry.timestamp)}`,
    role,
    content,
    timestamp: toTimestamp(entry.timestamp),
    sessionId: entry.sessionId || fallbackSessionId,
  };

  if (role === 'assistant' && entry.message.model) {
    message.model = entry.message.model;
  }

  return message;
}

export function convertClaudeJsonlToChatMessages(jsonl, sessionId) {
  return String(jsonl || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return convertClaudeHistoryEntry(JSON.parse(line), sessionId);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function readClaudeSessionMessages({ claudeProjectDir, sessionId }) {
  if (!claudeProjectDir || !sessionId) return [];
  const filePath = path.join(claudeProjectDir, `${sessionId}.jsonl`);
  try {
    const jsonl = await fs.readFile(filePath, 'utf8');
    return convertClaudeJsonlToChatMessages(jsonl, sessionId);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
