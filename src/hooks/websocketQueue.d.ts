export interface OutboundMessageQueue {
  send(message: Record<string, unknown>, isOpen: boolean): void;
  flush(): void;
  clear(): void;
  size(): number;
}

export function createOutboundMessageQueue(
  deliver: (message: Record<string, unknown>) => void,
): OutboundMessageQueue;
