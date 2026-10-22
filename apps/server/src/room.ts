import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage, type Side } from "@moba/protocol";
import { addDot, applyCommand, createWorld, FixedStepper, removeDot, snapshot, step, TICK_RATE, type World } from "@moba/sim";
import type { WebSocket } from "ws";
import type { BalanceVersion } from "./balance-loader.js";

interface Player {
  dotId: string;
  ackSeq: number;
}

/** One authoritative match. Pins its balance version for its whole life. */
export class Room {
  private readonly world: World;
  private readonly players = new Map<WebSocket, Player>();
  private readonly stepper = new FixedStepper();
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0;
  private nextSnapshotTick = 0;
  private nextDotId = 1;

  constructor(
    private readonly balance: BalanceVersion,
    private readonly snapshotRate: number,
  ) {
    this.world = createWorld(balance.data);
  }

  start(): void {
    this.lastTime = performance.now();
    // Wakes more often than the tick rate; the stepper decides how many ticks are due.
    this.timer = setInterval(() => this.update(), 1000 / (TICK_RATE * 2));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  join(ws: WebSocket): void {
    ws.on("message", (raw) => this.onMessage(ws, raw.toString()));
    ws.on("close", () => this.leave(ws));
  }

  private onMessage(ws: WebSocket, raw: string): void {
    const msg = parseClientMessage(raw);
    if (!msg) return; // Malformed input is dropped, never trusted.
    const player = this.players.get(ws);
    if (msg.t === "hello") {
      if (player) return;
      if (msg.protocol !== PROTOCOL_VERSION) {
        this.send(ws, { t: "error", message: `protocol ${msg.protocol} not supported, server speaks ${PROTOCOL_VERSION}` });
        ws.close();
        return;
      }
      const side: Side = this.players.size % 2 === 0 ? 0 : 1;
      const dotId = `p${this.nextDotId++}`;
      addDot(this.world, dotId, side);
      this.players.set(ws, { dotId, ackSeq: 0 });
      this.send(ws, {
        t: "welcome",
        protocol: PROTOCOL_VERSION,
        you: dotId,
        tickRate: TICK_RATE,
        balanceVersion: this.balance.id,
        balance: this.balance.data,
      });
      return;
    }
    if (!player) return;
    applyCommand(this.world, player.dotId, msg.cmd);
    player.ackSeq = Math.max(player.ackSeq, msg.cmd.seq);
  }

  private leave(ws: WebSocket): void {
    const player = this.players.get(ws);
    if (!player) return;
    removeDot(this.world, player.dotId);
    this.players.delete(ws);
  }

  private update(): void {
    const now = performance.now();
    const elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.stepper.advance(elapsed, () => {
      step(this.world);
      if (this.world.tick >= this.nextSnapshotTick) {
        this.nextSnapshotTick += TICK_RATE / this.snapshotRate;
        this.broadcastSnapshot();
      }
    });
  }

  private broadcastSnapshot(): void {
    for (const [ws, player] of this.players) {
      this.send(ws, { t: "snapshot", snap: snapshot(this.world, player.ackSeq) });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
