import type { ConnectionStatus, WSEvent, WSEventName } from "@/types/legacylift";

const WS_BASE_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL ?? "ws://localhost:8000";
const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 500;

type StatusListener = (status: ConnectionStatus) => void;
type EventCallback<K extends WSEventName> = (event: Extract<WSEvent, { event: K }>) => void;
type InternalEventCallback = (event: WSEvent) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private status: ConnectionStatus = "disconnected";
  private readonly listeners = new Map<WSEventName, Set<InternalEventCallback>>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(
    private readonly projectId: string,
    private readonly getToken?: () => Promise<string | null>,
  ) {}

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      return;
    }

    this.manuallyClosed = false;
    this.setStatus("connecting");

    let url = `${WS_BASE_URL.replace(/\/$/, "")}/ws/${encodeURIComponent(this.projectId)}`;
    if (this.getToken) {
      const token = await this.getToken().catch(() => null);
      if (token) url += `?token=${encodeURIComponent(token)}`;
    }
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
    };

    this.ws.onmessage = (message) => {
      this.handleMessage(message.data);
    };

    this.ws.onerror = () => {
      this.setStatus("error");
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.manuallyClosed) {
        this.setStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  on<K extends WSEventName>(event: K, callback: EventCallback<K>): () => void {
    const listeners = this.listeners.get(event) ?? new Set<InternalEventCallback>();
    const internalCallback: InternalEventCallback = (wsEvent) => {
      callback(wsEvent as Extract<WSEvent, { event: K }>);
    };

    listeners.add(internalCallback);
    this.listeners.set(event, listeners);

    return () => {
      listeners.delete(internalCallback);
    };
  }

  onStatusChange(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    callback(this.status);

    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data) as WSEvent | { type?: string };
      if (!("event" in event)) {
        return;
      }

      const listeners = this.listeners.get(event.event);
      listeners?.forEach((callback) => callback(event));
    } catch {
      this.setStatus("error");
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("connecting");
    const delay = BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => { void this.connect(); }, delay);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export function createWebSocketClient(
  projectId: string,
  getToken?: () => Promise<string | null>,
): WebSocketClient {
  return new WebSocketClient(projectId, getToken);
}
