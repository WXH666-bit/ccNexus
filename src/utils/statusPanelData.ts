import type {
  ChatMessage,
  ContentBlock,
  StatusData,
  StatusFileChange,
  StatusTaskItem,
  ToolUseBlock,
  SubAgentInfo,
} from '../types';
import { computeDiffStats } from './diff';
import {
  findToolResultForBlock,
  isFileModifyToolName,
  normalizeToolName,
  AGENT_TOOL_NAMES,
  isToolName,
} from './toolRendering.js';
import { normalizeToolInput } from './toolInputNormalization.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asId(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function normalizeTaskStatus(value: unknown): StatusTaskItem['status'] {
  if (value === 'in_progress' || value === 'completed' || value === 'deleted') {
    return value;
  }
  return 'pending';
}

function normalizeTaskItem(value: unknown): StatusTaskItem | null {
  const item = asRecord(value);
  const content = [
    item.content,
    item.subject,
    item.description,
    item.title,
    item.text,
    item.step,
  ].map(asText).find(Boolean);
  if (!content) return null;

  const blockedBy = Array.isArray(item.blockedBy)
    ? item.blockedBy.map(asId).filter(Boolean)
    : undefined;
  return {
    id: asId(item.id) || undefined,
    content,
    status: normalizeTaskStatus(item.status),
    ...(blockedBy?.length ? { blockedBy } : {}),
  };
}

function collectTaskIdMappings(messages: ChatMessage[]) {
  const mappings = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      const content = typeof block.content === 'string' ? block.content : '';
      const match = /\btask\s*#(\d+)/i.exec(content);
      if (match && block.tool_use_id) mappings.set(block.tool_use_id, match[1]);
    }
  }
  return mappings;
}

function deriveTasks(messages: ChatMessage[]): StatusData['tasks'] {
  const taskIdMappings = collectTaskIdMappings(messages);
  const pendingStructuredTasks: ToolUseBlock[] = [];
  let latestTodo: StatusTaskItem[] | undefined;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue;
      const toolName = normalizeToolName(block.name);
      const input = asRecord(block.input);

      if (toolName === 'todowrite' && Array.isArray(input.todos)) {
        latestTodo = input.todos
          .map(normalizeTaskItem)
          .filter((item): item is StatusTaskItem => item !== null);
      } else if (toolName === 'update_plan' && Array.isArray(input.plan)) {
        latestTodo = input.plan
          .map(normalizeTaskItem)
          .filter((item): item is StatusTaskItem => item !== null);
      } else if (toolName === 'taskcreate' || toolName === 'taskupdate') {
        pendingStructuredTasks.push(block);
      }
    }
  }

  if (latestTodo !== undefined) {
    const done = latestTodo.filter(item => item.status === 'completed').length;
    return { done, total: latestTodo.length, items: latestTodo };
  }
  if (pendingStructuredTasks.length === 0) return undefined;

  const taskMap = new Map<string, StatusTaskItem>();
  for (const block of pendingStructuredTasks) {
    const toolName = normalizeToolName(block.name);
    const input = asRecord(block.input);
    if (toolName === 'taskcreate') {
      const subject = asText(input.subject);
      if (!subject) continue;
      const description = asText(input.description);
      const id = taskIdMappings.get(block.id) || block.id;
      taskMap.set(id, {
        id,
        content: description ? subject + ': ' + description : subject,
        status: 'pending',
      });
      continue;
    }

    const taskId = asId(input.taskId);
    const task = taskMap.get(taskId);
    if (!task) continue;
    if (input.status === 'deleted') {
      taskMap.delete(taskId);
      continue;
    }
    if (input.status !== undefined) task.status = normalizeTaskStatus(input.status);
    const subject = asText(input.subject);
    if (subject) task.content = subject;

    if (Array.isArray(input.addBlockedBy)) {
      task.blockedBy = Array.from(new Set([
        ...(task.blockedBy || []),
        ...input.addBlockedBy.map(asId).filter(Boolean),
      ]));
    }
    if (Array.isArray(input.addBlocks)) {
      for (const blockedId of input.addBlocks.map(asId).filter(Boolean)) {
        const blocked = taskMap.get(blockedId);
        if (!blocked) continue;
        blocked.blockedBy = Array.from(new Set([...(blocked.blockedBy || []), taskId]));
      }
    }
  }

  const items = Array.from(taskMap.values());
  return {
    done: items.filter(item => item.status === 'completed').length,
    total: items.length,
    items,
  };
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function extractFilePath(input: Record<string, unknown>) {
  return [
    input.file_path,
    input.filePath,
    input.path,
    input.target_file,
    input.targetFile,
  ].map(asText).find(Boolean) || '';
}

function deriveFileChanges(
  messages: ChatMessage[],
  startFromIndex = 0,
  processedFiles: readonly string[] = [],
): StatusData['edits'] {
  const files = new Map<string, StatusFileChange>();
  const processedFileSet = new Set(processedFiles);

  messages.forEach((message, messageIndex) => {
    if (messageIndex < startFromIndex) return;
    message.content.forEach((block: ContentBlock) => {
      if (block.type !== 'tool_use' || !isFileModifyToolName(block.name)) return;
      const result = findToolResultForBlock(messages, messageIndex, block.id);
      if (!result || result.is_error) return;

      const input = asRecord(normalizeToolInput(block.name, block.input));
      const path = extractFilePath(input);
      if (!path || processedFileSet.has(path)) return;
      const oldString = asText(input.old_string);
      const newString = asText(input.new_string);
      const diff = computeDiffStats(oldString, newString);
      const existing = files.get(path);
      const next: StatusFileChange = existing || {
        path,
        name: fileNameFromPath(path),
        status: oldString ? 'M' : 'A',
        additions: 0,
        deletions: 0,
        operations: [],
      };
      next.additions += diff.additions;
      next.deletions += diff.deletions;
      next.status = next.status === 'M' || oldString ? 'M' : 'A';
      next.operations = [
        ...(next.operations || []),
        { oldString, newString, replaceAll: input.replace_all === true },
      ];
      files.set(path, next);
    });
  });

  if (files.size === 0) return undefined;
  const changes = Array.from(files.values());
  return {
    additions: changes.reduce((sum, file) => sum + file.additions, 0),
    deletions: changes.reduce((sum, file) => sum + file.deletions, 0),
    files: changes,
  };
}

function deriveSubagents(messages: ChatMessage[]): SubAgentInfo[] {
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index;
  });
  const agents: SubAgentInfo[] = [];
  messages.slice(lastUserIndex + 1).forEach((message, offset) => {
    if (message.role !== 'assistant') return;
    const messageIndex = lastUserIndex + 1 + offset;
    message.content.forEach(block => {
      if (block.type !== 'tool_use' || !isToolName(block.name, AGENT_TOOL_NAMES)) return;
      const result = findToolResultForBlock(messages, messageIndex, block.id);
      const input = asRecord(block.input);
      const description = asText(input.description) || asText(input.prompt) || block.name;
      agents.push({
        id: block.id,
        name: block.name,
        type: block.name,
        description,
        prompt: asText(input.prompt) || undefined,
        status: result ? (result.is_error ? 'error' : 'completed') : message.isStreaming ? 'running' : 'idle',
        toolUseId: block.id,
        resultText: typeof result?.content === 'string' ? result.content : undefined,
      });
    });
  });
  return agents;
}

export interface StatusDerivationOptions {
  startFromIndex?: number;
  processedFiles?: readonly string[];
}

export function deriveStatusData(
  messages: ChatMessage[],
  options: StatusDerivationOptions = {},
): Pick<StatusData, 'tasks' | 'edits' | 'subagents'> {
  return {
    tasks: deriveTasks(messages),
    edits: deriveFileChanges(messages, options.startFromIndex ?? 0, options.processedFiles ?? []),
    subagents: deriveSubagents(messages),
  };
}
