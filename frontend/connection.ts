import { snapshotSchema, type ControlAction, type Snapshot } from './contracts';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'invalid';

export class FlightConnection {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 1000;

  constructor(
    private readonly url: string,
    private readonly onSnapshot: (snapshot: Snapshot) => void,
    private readonly onState: (state: ConnectionState) => void,
  ) {}

  connect(): void {
    this.dispose();
    this.onState('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.retryDelay = 1000;
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      let snapshot: Snapshot;
      try {
        snapshot = snapshotSchema.parse(JSON.parse(event.data));
      } catch {
        this.send('pause');
        this.dispose();
        this.onState('invalid');
        return;
      }
      // Presentation errors must not be disguised as malformed network messages.
      this.onState('connected');
      this.onSnapshot(snapshot);
    };
    socket.onclose = () => {
      this.socket = null;
      this.onState('disconnected');
      this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
    };
  }

  send(action: ControlAction): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ action }));
    return true;
  }

  dispose(): void {
    clearTimeout(this.retryTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
      this.socket = null;
    }
  }
}
