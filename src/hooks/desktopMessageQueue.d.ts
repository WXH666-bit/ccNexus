export interface OutboundMessageQueue {
  send(message: Record<string, unknown>, isReady: boolean): void;
  flush(): void;
  clear(): void;
  size(): number;
}

export function createOutboundMessageQueue(
  deliver: (message: Record<string, unknown>) => void,
): OutboundMessageQueue;

export interface InboundMessageQueue<TMessage = unknown> {
  push(message: TMessage): void;
  consumeFrom(cursor: number): { messages: TMessage[]; nextCursor: number };
  clear(): void;
  size(): number;
}

export function createInboundMessageQueue<TMessage = unknown>(): InboundMessageQueue<TMessage>;

export function isPriorityDesktopMessage(message: { type?: string } | null | undefined): boolean;
