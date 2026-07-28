import { useRef, useCallback, useEffect, useState } from 'react';
import type { WSMessage } from '../types';
import { createInboundMessageQueue, createOutboundMessageQueue } from './websocketQueue.js';

interface UseWebSocketReturn {
  send: (msg: Record<string, unknown>) => void;
  lastMessage: WSMessage | null;
  incomingMessages: WSMessage[];
  connected: boolean;
}

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [incomingVersion, setIncomingVersion] = useState(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const outboundQueueRef = useRef<ReturnType<typeof createOutboundMessageQueue> | null>(null);
  const inboundQueueRef = useRef<ReturnType<typeof createInboundMessageQueue<WSMessage>> | null>(null);

  if (!outboundQueueRef.current) {
    outboundQueueRef.current = createOutboundMessageQueue((message) => {
      const socket = wsRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    });
  }
  if (!inboundQueueRef.current) {
    inboundQueueRef.current = createInboundMessageQueue<WSMessage>();
  }

  const connect = useCallback(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      outboundQueueRef.current?.flush();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        inboundQueueRef.current?.push(msg);
        setLastMessage(msg);
        setIncomingVersion((version) => version + 1);
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => { /* onclose will fire */ };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      outboundQueueRef.current?.clear();
      inboundQueueRef.current?.clear();
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const isOpen = wsRef.current?.readyState === WebSocket.OPEN;
    outboundQueueRef.current?.send(msg, isOpen);
  }, []);

  const incomingMessages = inboundQueueRef.current?.consumeFrom(0).messages ?? [];

  return { send, lastMessage, incomingMessages, connected };
}
