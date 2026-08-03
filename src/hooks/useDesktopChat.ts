import { useRef, useCallback, useEffect, useState } from 'react';
import type { DesktopChatEvent } from '../types';
import { createInboundMessageQueue, createOutboundMessageQueue } from './desktopMessageQueue.js';

interface UseDesktopChatReturn {
  send: (msg: Record<string, unknown>) => void;
  lastMessage: DesktopChatEvent | null;
  incomingMessages: DesktopChatEvent[];
  connected: boolean;
}

export function useDesktopChat(): UseDesktopChatReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<DesktopChatEvent | null>(null);
  const desktopUnsubscribeRef = useRef<(() => void) | null>(null);
  const outboundQueueRef = useRef<ReturnType<typeof createOutboundMessageQueue> | null>(null);
  const inboundQueueRef = useRef<ReturnType<typeof createInboundMessageQueue<DesktopChatEvent>> | null>(null);

  if (!outboundQueueRef.current) {
    outboundQueueRef.current = createOutboundMessageQueue((message) => {
      window.ccNexusDesktop?.sendChatCommand(message);
    });
  }
  if (!inboundQueueRef.current) {
    inboundQueueRef.current = createInboundMessageQueue<DesktopChatEvent>();
  }

  const connect = useCallback(() => {
    const desktopApi = window.ccNexusDesktop;
    if (!desktopApi?.sendChatCommand || !desktopApi.onChatMessage) {
      setConnected(false);
      return;
    }

    desktopUnsubscribeRef.current?.();
    desktopUnsubscribeRef.current = desktopApi.onChatMessage((msg) => {
      inboundQueueRef.current?.push(msg as DesktopChatEvent);
      setLastMessage(msg as DesktopChatEvent);
    });
    setConnected(true);
    outboundQueueRef.current?.flush();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      desktopUnsubscribeRef.current?.();
      desktopUnsubscribeRef.current = null;
      outboundQueueRef.current?.clear();
      inboundQueueRef.current?.clear();
      setConnected(false);
    };
  }, [connect]);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (!window.ccNexusDesktop?.sendChatCommand) return;
    outboundQueueRef.current?.send(msg, true);
  }, []);

  const incomingMessages = inboundQueueRef.current?.consumeFrom(0).messages ?? [];

  return { send, lastMessage, incomingMessages, connected };
}
