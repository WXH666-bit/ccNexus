// ─── Content block types (matching Anthropic API) ────────────────
export interface TextBlock {
  type: 'text';
  text: string;
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
}

// ─── Session ─────────────────────────────────────────────────────
export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  isFavorite?: boolean;
  messageCount?: number;
  summary?: string;
}

// ─── Desktop chat event types ────────────────────────────────────
export type DesktopChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'stream_event'; event: unknown; sessionId?: string; uuid?: string }
  | { type: 'assistant'; message: { id: string; content: ContentBlock[]; model?: string; usage?: UsageStats; sessionId?: string; cost?: number; duration?: number; turns?: number } }
  | { type: 'usage_update'; sessionId?: string; percentage: number; totalTokens: number; limit: number; usedTokens: number; maxTokens: number }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'tool_progress'; tool_name: string; tool_use_id: string; status: 'running' | 'completed' | 'error' }
  | { type: 'permission_request'; requestId: string; toolName: string; input: Record<string, unknown>; title?: string; displayName?: string }
  | { type: 'status'; status: 'thinking' | 'idle' }
  | { type: 'error'; message: string; invalidSessionId?: string }
  | { type: 'result'; subtype: string; duration?: number; cost?: number; turns?: number; is_error?: boolean; sessionId?: string }
  | { type: 'session_list'; sessions: Session[]; deletedSessionIds?: string[] }
  | { type: 'session_history'; sessionId: string; messages: ChatMessage[] }
  | { type: 'session_created'; session: Session }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_renamed'; session_id: string; title: string }
  | { type: 'rewind_complete'; messages: ChatMessage[] }
  | { type: 'plan_approval'; plan: PlanApprovalRequest }
  | { type: 'ask_user_question'; question: AskUserQuestionRequest }
  | { type: 'subagent_update'; agents: SubAgentInfo[] }
  | { type: 'undo_complete'; success: boolean; filePath?: string; error?: string };

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
export interface StatusData {
  tasks?: { done: number; total: number; items?: string[] };
  subagents?: { name: string; status: string }[];
  edits?: { additions: number; deletions: number; files: string[] };
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
  description?: string;
  progress?: number;
  toolUseId?: string;
}

export interface AgentGroupData {
  agents: SubAgentInfo[];
  totalTasks: number;
  completedTasks: number;
}

// ─── Plan Approval ───────────────────────────────────────────────
export interface PlanApprovalRequest {
  plan_id: string;
  title: string;
  steps: string[];
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
