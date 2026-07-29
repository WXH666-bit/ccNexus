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

const COMMAND_MESSAGE_REGEX = /<command-message>([\s\S]*?)<\/command-message>/;
const COMMAND_ARGS_REGEX = /<command-args>([\s\S]*?)<\/command-args>/;
const TASK_NOTIFICATION_REGEX_WITH_STATUS = /<task-notification>[\s\S]*?<status>([\s\S]*?)<\/status>[\s\S]*?<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/task-notification>/;
const TASK_NOTIFICATION_REGEX_NO_STATUS = /<task-notification>[\s\S]*?<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/task-notification>/;
const TASK_NOTIFICATION_EVENT_REGEX = /<event>([\s\S]*?)<\/event>/;
const FILTERED_NORMALIZE_TAGS = [
  '<command-name>',
  '<command-args>',
  '<skill-format>',
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<local-command-stderr>',
];

function containsAnyTag(text, tags) {
  return tags.some((tag) => text.includes(tag));
}

function hasCommandMessageTag(text) {
  return text.includes('<command-message>') && text.includes('</command-message>');
}

function formatCommandForDisplay(text) {
  const messageMatch = COMMAND_MESSAGE_REGEX.exec(text);
  const commandMessage = messageMatch?.[1]?.trim();
  if (!commandMessage) return null;

  const args = COMMAND_ARGS_REGEX.exec(text)?.[1]?.trim() ?? '';
  return args ? `/${commandMessage} ${args}` : `/${commandMessage}`;
}

function createTaskNotificationBlock(text) {
  if (!text.includes('<task-notification>')) return null;

  const detail = TASK_NOTIFICATION_EVENT_REGEX.exec(text)?.[1]?.trim() || undefined;
  const withStatus = TASK_NOTIFICATION_REGEX_WITH_STATUS.exec(text);
  if (withStatus?.[2]?.trim()) {
    const block = {
      type: 'task_notification',
      icon: '●',
      summary: withStatus[2].trim(),
      status: withStatus[1]?.trim() || 'completed',
    };
    if (detail) block.detail = detail;
    return block;
  }

  const withoutStatus = TASK_NOTIFICATION_REGEX_NO_STATUS.exec(text);
  if (withoutStatus?.[1]?.trim()) {
    const block = {
      type: 'task_notification',
      icon: '●',
      summary: withoutStatus[1].trim(),
      status: 'completed',
    };
    if (detail) block.detail = detail;
    return block;
  }

  return null;
}

function normalizeTextBlock(text, isUserMessage) {
  const rawText = text ?? '';
  if (rawText.trim() === '(no content)') return null;

  const taskNotification = createTaskNotificationBlock(rawText);
  if (taskNotification) return taskNotification;

  if (isUserMessage && hasCommandMessageTag(rawText)) {
    const displayContent = formatCommandForDisplay(rawText);
    return displayContent ? textBlock(displayContent) : null;
  }

  if (!rawText.trim() || (isUserMessage && containsAnyTag(rawText, FILTERED_NORMALIZE_TAGS))) {
    return null;
  }

  return textBlock(rawText);
}

function normalizeToolResultContent(content) {
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

function normalizeContent(content, isUserMessage = false) {
  if (typeof content === 'string') {
    const block = normalizeTextBlock(content, isUserMessage);
    return block ? [block] : [];
  }
  if (!Array.isArray(content)) return [];

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return null;
      if (block.type === 'text') return normalizeTextBlock(block.text, isUserMessage);
      if (block.type === 'thinking') {
        const thinking = typeof block.thinking === 'string'
          ? block.thinking
          : typeof block.text === 'string'
            ? block.text
            : '';
        return { type: 'thinking', thinking, text: thinking };
      }
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

  const isUserMessage = entry.type === 'user' || entry.message.role === 'user';
  const content = normalizeContent(entry.message.content, isUserMessage);
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

  if (role === 'assistant' && entry.message.usage && typeof entry.message.usage === 'object') {
    message.usage = entry.message.usage;
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
