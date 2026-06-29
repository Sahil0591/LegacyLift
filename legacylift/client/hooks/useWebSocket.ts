"use client";
// hooks/useWebSocket.ts — React hook wrapping lib/websocket.ts.
// Creates one WebSocketClient per projectId, manages its lifecycle with React,
// and exposes the connection status plus a subscribe function.
//
// TODO: Add auth header passing once backend JWT auth is implemented.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWebSocketClient, type WebSocketClient } from "@/lib/websocket";
import type { ConnectionStatus, WSEvent, WSEventName } from "@/types/legacylift";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  /** Subscribe to a specific WS event. Returns an unsubscribe function. */
  subscribe: <K extends WSEventName>(
    event: K,
    callback: (e: Extract<WSEvent, { event: K }>) => void,
  ) => () => void;
}

export function useWebSocket(projectId: string | null): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const clientRef = useRef<WebSocketClient | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const client = createWebSocketClient(projectId);
    clientRef.current = client;

    const unsubStatus = client.onStatusChange(setStatus);
    client.connect();

    return () => {
      unsubStatus();
      client.disconnect();
      clientRef.current = null;
    };
  }, [projectId]);

  const subscribe = useCallback(
    <K extends WSEventName>(
      event: K,
      callback: (e: Extract<WSEvent, { event: K }>) => void,
    ) => {
      if (!clientRef.current) return () => {};
      return clientRef.current.on(event, callback);
    },
    [],
  );

  return useMemo(() => ({ status, subscribe }), [status, subscribe]);
}
