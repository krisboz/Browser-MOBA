import { PROTOCOL_VERSION, type Command, type ServerMessage } from "@moba/protocol";

type CommandBody = Command extends infer C ? (C extends Command ? Omit<C, "seq"> : never) : never;

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  onClose(): void;
}

/** The socket to the authoritative server. Sends commands, hands every server message to the game. */
export class Net {
  private readonly ws: WebSocket;
  private seq = 0;

  constructor(url: string, handlers: NetHandlers) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => this.ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION })));
    this.ws.addEventListener("message", (e) => handlers.onMessage(JSON.parse(String(e.data)) as ServerMessage));
    this.ws.addEventListener("close", () => handlers.onClose());
  }

  send(body: CommandBody): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const cmd = { ...body, seq: ++this.seq } as Command;
    this.ws.send(JSON.stringify({ t: "cmd", cmd }));
  }

  close(): void {
    this.ws.close();
  }
}
