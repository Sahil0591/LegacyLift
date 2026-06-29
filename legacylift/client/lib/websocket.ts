import type { ConnectionStatus, WSEvent, WSEventName } from "@/types/legacylift";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

type StatusListener = (status: ConnectionStatus) => void;
type EventListener<K extends WSEventName = WSEventName> = (
  event: Extract<WSEvent, { event: K }>,
) => void;
type StoredEventListener = (event: WSEvent) => void;

export interface WebSocketClient {
  connect(): void;
  disconnect(): void;
  onStatusChange(callback: StatusListener): () => void;
  on<K extends WSEventName>(event: K, callback: EventListener<K>): () => void;
}

export function createWebSocketClient(projectId: string): WebSocketClient {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = "disconnected";

  const statusListeners = new Set<StatusListener>();
  const eventListeners = new Map<WSEventName, Set<StoredEventListener>>();

  const setStatus = (nextStatus: ConnectionStatus) => {
    status = nextStatus;
    statusListeners.forEach((listener) => listener(status));
  };

  const emitEvent = (event: WSEvent) => {
    const listeners = eventListeners.get(event.event);
    listeners?.forEach((listener) => listener(event as never));
  };

  return {
    connect() {
      if (socket && socket.readyState !== WebSocket.CLOSED) return;

      setStatus("connecting");
      socket = new WebSocket(`${WS_BASE_URL}/ws/${projectId}`);

      socket.onopen = () => setStatus("connected");
      socket.onclose = () => setStatus("disconnected");
      socket.onerror = () => setStatus("error");
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as WSEvent;
          emitEvent(event);
        } catch {
          // Ignore non-event messages such as backend ack payloads.
        }
      };
    },

    disconnect() {
      socket?.close();
      socket = null;
      setStatus("disconnected");
    },

    onStatusChange(callback: StatusListener) {
      statusListeners.add(callback);
      callback(status);
      return () => {
        statusListeners.delete(callback);
      };
    },

    on<K extends WSEventName>(event: K, callback: EventListener<K>) {
      const listeners = eventListeners.get(event) ?? new Set<StoredEventListener>();
      const storedCallback: StoredEventListener = (payload) => {
        callback(payload as Extract<WSEvent, { event: K }>);
      };

      listeners.add(storedCallback);
      eventListeners.set(event, listeners);

      return () => {
        listeners.delete(storedCallback);
        if (listeners.size === 0) eventListeners.delete(event);
      };
    },
  };
}
