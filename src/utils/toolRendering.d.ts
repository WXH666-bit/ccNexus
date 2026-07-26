import type { ChatMessage, ContentBlock, ToolResultBlock, ToolUseBlock } from '../types';

export const READ_TOOL_NAMES: Set<string>;
export const EDIT_TOOL_NAMES: Set<string>;
export const BASH_TOOL_NAMES: Set<string>;
export const SEARCH_TOOL_NAMES: Set<string>;
export const AGENT_TOOL_NAMES: Set<string>;
export const TASK_MANAGE_TOOL_NAMES: Set<string>;
export const TRANSIENT_INTERNAL_TOOL_NAMES: Set<string>;

export type GroupedBlock =
  | { type: 'single'; block: ContentBlock; originalIndex: number }
  | { type: 'read_group'; blocks: ToolUseBlock[]; startIndex: number }
  | { type: 'edit_group'; blocks: ToolUseBlock[]; startIndex: number }
  | { type: 'bash_group'; blocks: ToolUseBlock[]; startIndex: number }
  | { type: 'search_group'; blocks: ToolUseBlock[]; startIndex: number }
  | { type: 'agent_group'; agentBlock: ToolUseBlock; followingBlocks: ToolUseBlock[]; startIndex: number };

export function normalizeToolName(toolName?: string): string;
export function isToolName(toolName: string | undefined, toolSet: Set<string>): boolean;
export function isTransientInternalToolName(toolName: string | undefined): boolean;
export function shouldRenderToolUse(toolName: string | undefined, isStreaming: boolean): boolean;
export function getToolGroupType(block: ContentBlock): GroupedBlock['type'] | null;
export function groupBlocks(blocks: ContentBlock[]): GroupedBlock[];
export function findToolResultForBlock(
  messages: ChatMessage[],
  messageIndex: number,
  toolId: string | undefined,
): ToolResultBlock | null;
