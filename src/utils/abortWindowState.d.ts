export interface AbortWindowState {
  sessionId: string | null;
}

export interface AbortWindowEvent {
  type?: string;
  status?: string;
  reason?: string;
  sessionId?: string;
}

export interface QueuedChatMessage {
  id: string;
  text: string;
  timestamp: number;
  attachments: { type: string; data: string; described?: boolean }[];
  reasoningEffort?: string;
  agent?: string;
  streaming?: boolean;
  alwaysThinking?: boolean;
  modelOverride?: string;
  displayText?: string;
}

export function beginAbortWindow(sessionId?: string | null): AbortWindowState;
export function completeAbortWindow(
  stopping: AbortWindowState | null,
  event: AbortWindowEvent,
): AbortWindowState | null;
export function shouldQueueChatMessage(args: {
  isStreaming: boolean;
  stopping: AbortWindowState | null;
}): boolean;
export function createQueuedChatMessage(message: Omit<QueuedChatMessage, 'attachments'> & {
  attachments?: { type: string; data: string; described?: boolean }[];
}): QueuedChatMessage;
export function queuedChatMessageToSendArgs(message: QueuedChatMessage): [
  string,
  { type: string; data: string; described?: boolean }[],
  false,
  string | undefined,
  string | undefined,
  boolean | undefined,
  boolean | undefined,
  string | undefined,
  string | undefined,
];
