import { PROTOCOL_VERSION, type ClientMessage, type Command, type ServerMessage } from "@moba/protocol";

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  onClose(): void;
}

/**
 * The socket to the authoritative server.
 * `addedPing` is the dev lag switch: it holds every message for half of it in each direction.
 */
export class Net {
  private readonly ws: WebSocket;
  addedPing = 0;

  constructor(url: string, private readonly handlers: NetHandlers) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => this.ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION })));
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      this.later(() => this.handlers.onMessage(msg));
    });
    this.ws.addEventListener("close", () => this.handlers.onClose());
  }

  command(cmd: Command): void {
    this.send({ t: "cmd", cmd });
  }

  ping(id: number): void {
    this.send({ t: "ping", id });
  }

  close(): void {
    this.ws.close();
  }

  private send(msg: ClientMessage): void {
    const raw = JSON.stringify(msg);
    this.later(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    });
  }

  private later(fn: () => void): void {
    if (this.addedPing > 0) setTimeout(fn, this.addedPing / 2);
    else fn();
  }
}
