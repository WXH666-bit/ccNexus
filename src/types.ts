// ─── Content block types (matching Anthropic API) ────────────────
export interface TextBlock {
  type: 'text';
  text: string;
}

export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
];

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  _partialInput?: string;
  _partialCommand?: string;
  _partialContent?: string;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown[];
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  src: string;
  mediaType?: string;
  alt?: string;
  described?: boolean;
}

export interface AttachmentBlock {
  type: 'attachment';
  fileName?: string;
  mediaType?: string;
}

export interface TaskNotificationBlock {
  type: 'task_notification';
  icon: string;
  summary: string;
  status: string;
  detail?: string;
}

export interface CompactNotificationBlock {
  type: 'compact_notification';
  headerText: string;
  items: { type: 'stdout'; text: string }[];
}

export interface CompactSummaryBlock {
  type: 'compact_summary';
  title: string;
  content: string;
  metadata?: {
    messagesSummarized?: number;
    direction?: 'up_to' | 'from';
    userContext?: string;
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
  };
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | AttachmentBlock
  | TaskNotificationBlock
  | CompactNotificationBlock
  | CompactSummaryBlock;

// ── Chat message ────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  /** Inner Claude API message.id used to deduplicate repeated JSONL blocks. */
  usageMessageId?: string;
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
  timestamp: number;
  sessionId?: string;
  model?: string;
  usage?: UsageStats;
  isStreaming?: boolean;
  cost?: number;
  duration?: number;
  turns?: number;
  runtimeClassification?: 'cold' | 'warm';
  runtimeRetirementReason?: string;
}

// ─── Session ─────────────────────────────────────────────────────
export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  isFavorite?: boolean;
  favoritedAt?: number;
  messageCount?: number;
  summary?: string;
}

// ─── Desktop chat event types ────────────────────────────────────
export type DesktopChatEvent =
  | { type: 'session'; sessionId: string; title?: string; updatedAt?: number }
  | { type: 'system'; subtype?: string; sessionId?: string }
  | { type: 'stream_event'; event: unknown; sessionId?: string; uuid?: string }
  | { type: 'assistant'; sessionId?: string; message: { id: string; content: ContentBlock[]; model?: string; usage?: UsageStats; sessionId?: string; session_id?: string; cost?: number; duration?: number; turns?: number; runtimeClassification?: 'cold' | 'warm'; runtimeRetirementReason?: string } }
  | { type: 'usage_update'; sessionId?: string; percentage: number; totalTokens: number; limit: number; usedTokens: number; maxTokens: number; runtimeClassification?: 'cold' | 'warm'; runtimeRetirementReason?: string }
  | { type: 'tool_result'; sessionId?: string; uuid?: string; tool_use_id?: string; toolUseId?: string; content: string; is_error?: boolean }
  | { type: 'tool_progress'; sessionId?: string; toolName?: string; tool_name?: string; toolUseId?: string; tool_use_id?: string; elapsed?: number; status?: 'running' | 'completed' | 'error' }
  | { type: 'tool_use_summary'; sessionId?: string; summary?: string; precedingIds?: string[] }
  | { type: 'permission_request'; sessionId?: string; requestId: string; toolName: string; input: Record<string, unknown>; title?: string; displayName?: string }
  | { type: 'status'; sessionId?: string; status: 'thinking' | 'idle'; reason?: 'abort-complete' }
  | { type: 'sdk_event'; sdkType?: string; sessionId?: string }
  | { type: 'error'; sessionId?: string; message: string; invalidSessionId?: string }
  | { type: 'result'; subtype: string; duration?: number; cost?: number; turns?: number; is_error?: boolean; sessionId?: string }
  | { type: 'session_list'; sessions: Session[]; deletedSessionIds?: string[] }
  | { type: 'session_history'; sessionId: string; messages: ChatMessage[] }
  | { type: 'session_created'; session: Session }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_renamed'; session_id: string; title: string }
  | { type: 'session_favorite_changed'; sessionId: string; isFavorite: boolean; favoritedAt?: number }
  | { type: 'rewind_complete'; sessionId?: string; messages: ChatMessage[] }
  | {
      type: 'plan_approval';
      sessionId?: string;
      requestId: string;
      toolName: string;
      plan: string;
      allowedPrompts: { tool: string; prompt: string }[];
    }
  | { type: 'mode_changed'; sessionId?: string; mode: PermissionMode; source?: string }
  | { type: 'runtime_lifecycle'; sessionId?: string; classification: 'cold' | 'warm'; reason?: string }
  | {
      type: 'ask_user_question';
      sessionId?: string;
      questionId: string;
      question: string;
      options?: string[];
      context?: string;
      toolUseId?: string;
    }
  | { type: 'subagent_update'; sessionId?: string; agents: SubAgentInfo[] }
  | { type: 'undo_complete'; sessionId?: string; success: boolean; filePath?: string; error?: string };

// ─── Tool call card types ────────────────────────────────────────
export interface EditFileData {
  file_path: string;
  old_string?: string;
  new_string?: string;
  diff_stats?: { additions: number; deletions: number };
}

export interface BashToolData {
  command: string;
}

export interface ReadFileData {
  file_path: string;
}

export interface TaskExecutionData {
  description: string;
  status?: 'running' | 'completed' | 'error';
}

// ─── Status panel data ──────────────────────────────────────────
export interface StatusTaskItem {
  id?: string;
  content: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
  blockedBy?: string[];
}

export interface StatusFileOperation {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface StatusFileChange {
  path: string;
  name: string;
  status?: 'A' | 'M';
  additions: number;
  deletions: number;
  operations?: StatusFileOperation[];
}

export interface SubagentHistoryResponse {
  success: boolean;
  toolUseId?: string;
  agentId?: string;
  sessionId?: string;
  error?: string;
  messages?: unknown[];
}

export interface StatusData {
  tasks?: { done: number; total: number; items?: Array<string | StatusTaskItem> };
  subagents?: SubAgentInfo[];
  edits?: { additions: number; deletions: number; files: Array<string | StatusFileChange> };
}

// ─── Permission ──────────────────────────────────────────────────
export interface PermissionRequest {
  permission_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

// ─── Rewind ──────────────────────────────────────────────────────
export interface RewindTarget {
  messageId: string;
  messageIndex: number;
  timestamp: number;
  preview: string;
}

// ─── Search ──────────────────────────────────────────────────────
export interface SearchResult {
  messageId: string;
  messageIndex: number;
  blockIndex: number;
  matchText: string;
  contextBefore: string;
  contextAfter: string;
}

// ─── Anchor ──────────────────────────────────────────────────────
export interface MessageAnchor {
  messageId: string;
  label: string;
  timestamp: number;
  role: 'user' | 'assistant' | 'system';
  kind: 'user_message' | 'assistant_text' | 'tool_call' | 'thinking' | 'system';
}

// ─── Sub-agent ───────────────────────────────────────────────────
export interface SubAgentInfo {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error' | 'idle';
  type?: string;
  description?: string;
  prompt?: string;
  progress?: number;
  toolUseId?: string;
  agentId?: string;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  toolStats?: Record<string, number>;
  resultText?: string;
}

export interface AgentGroupData {
  agents: SubAgentInfo[];
  totalTasks: number;
  completedTasks: number;
}

// ─── Plan Approval ───────────────────────────────────────────────
export interface PlanApprovalRequest {
  requestId: string;
  toolName?: string;
  plan: string;
  allowedPrompts: { tool: string; prompt: string }[];
  responseType?: 'plan' | 'permission';
  // Kept optional for session history produced by the older renderer contract.
  plan_id?: string;
  title?: string;
  steps?: string[];
  summary?: string;
}

// ─── Ask User Question ───────────────────────────────────────────
export interface AskUserQuestionRequest {
  question_id: string;
  question: string;
  options?: string[];
  context?: string;
  tool_use_id?: string;
}

// ─── Usage Stats ─────────────────────────────────────────────────
export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ─── File Edit Tracking ──────────────────────────────────────────
export interface FileEditRecord {
  filePath: string;
  originalContent: string;
  additions: number;
  deletions: number;
}

// ─── Extended desktop chat event types ───────────────────────────
// ─── View routes ─────────────────────────────────────────────────
export type ViewRoute = 'chat' | 'history' | 'settings';
