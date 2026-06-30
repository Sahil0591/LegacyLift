"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
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
  const { getToken } = useAuth();

  useEffect(() => {
    if (!projectId) return;

    const client = createWebSocketClient(projectId, () => getToken());
    clientRef.current = client;

    const unsubStatus = client.onStatusChange(setStatus);
    void client.connect();

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
