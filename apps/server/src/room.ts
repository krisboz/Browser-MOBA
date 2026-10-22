import { PROTOCOL_VERSION, parseClientMessage, type Command, type GameEvent, type ServerMessage, type Side } from "@moba/protocol";
import {
  addDot,
  applyCommand,
  createWorld,
  drainEvents,
  FixedStepper,
  isVisibleTo,
  loadoutFor,
  removeDot,
  resetHealth,
  resetMatch,
  setPatrol,
  snapshot,
  step,
  TICK_RATE,
  type World,
} from "@moba/sim";
import type { WebSocket } from "ws";
import type { BalanceVersion } from "./balance-loader.js";

// A command may be tagged at most this far ahead of the server, so a client can't queue moves for later.
const MAX_LEAD_TICKS = TICK_RATE;
// After a win, the next match starts this many seconds later.
const RESTART_AFTER = 5;
const DUMMY_ID = "dummy";

interface Player {
  dotId: string;
  side: Side;
  /** Commands waiting for their tick, in arrival order. */
  queue: Command[];
  ackSeq: number;
  /** Events since this player's last snapshot. */
  events: GameEvent[];
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
  private restartIn: number | null = null;

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
    switch (msg.t) {
      case "hello": {
        if (player) return;
        if (msg.protocol !== PROTOCOL_VERSION) {
          this.send(ws, { t: "error", message: `protocol ${msg.protocol} not supported, server speaks ${PROTOCOL_VERSION}` });
          ws.close();
          return;
        }
        const loadout = loadoutFor(this.world.balance, msg.preset);
        if (!loadout) {
          this.send(ws, { t: "error", message: `unknown preset "${msg.preset}"` });
          ws.close();
          return;
        }
        const side: Side = [...this.players.values()].some((p) => p.side === 0) ? 1 : 0;
        const dotId = `p${this.nextDotId++}`;
        addDot(this.world, { id: dotId, side, loadout });
        this.players.set(ws, { dotId, side, queue: [], ackSeq: 0, events: [] });
        this.updateDummy();
        this.send(ws, {
          t: "welcome",
          protocol: PROTOCOL_VERSION,
          you: dotId,
          side,
          loadout,
          tick: this.world.tick,
          tickRate: TICK_RATE,
          balanceVersion: this.balance.id,
          balance: this.balance.data,
        });
        return;
      }
      case "ping":
        this.send(ws, { t: "pong", id: msg.id, tick: this.world.tick });
        return;
      case "dummy": {
        const dummy = this.world.dots.get(DUMMY_ID);
        if (!player || !dummy) return;
        if (msg.action === "reset") resetHealth(dummy);
        else setPatrol(this.world, dummy, !dummy.patrol);
        return;
      }
      case "cmd":
        if (!player || msg.cmd.seq <= player.ackSeq) return;
        player.queue.push({ ...msg.cmd, tick: Math.min(msg.cmd.tick, this.world.tick + MAX_LEAD_TICKS) });
        return;
    }
  }

  private leave(ws: WebSocket): void {
    const player = this.players.get(ws);
    if (!player) return;
    removeDot(this.world, player.dotId);
    this.players.delete(ws);
    // Nobody left: whoever comes next starts a fresh match.
    if (!this.players.size) {
      this.restartIn = null;
      resetMatch(this.world);
    }
    this.updateDummy();
  }

  /** The target dummy stands in for the other side while only one person is here. */
  private updateDummy(): void {
    const sides = new Set([...this.players.values()].map((p) => p.side));
    const dummy = this.world.dots.get(DUMMY_ID);
    const wanted = sides.size === 1 ? ((1 - [...sides][0]!) as Side) : null;
    if (dummy && dummy.side !== wanted) removeDot(this.world, DUMMY_ID);
    if (wanted !== null && (!dummy || dummy.side !== wanted)) {
      const { x, y } = this.world.balance.dummy;
      addDot(this.world, { id: DUMMY_ID, side: wanted, loadout: loadoutFor(this.world.balance, "vanilla")!, pos: { x, y }, dummy: true });
    }
  }

  private update(): void {
    const now = performance.now();
    const elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.stepper.advance(elapsed, () => this.tick());
  }

  private tick(): void {
    // Commands run on the tick they were tagged with; late ones run now, which the client's reconciliation absorbs.
    for (const player of this.players.values()) {
      const due = player.queue.filter((c) => c.tick <= this.world.tick);
      if (!due.length) continue;
      player.queue = player.queue.filter((c) => c.tick > this.world.tick);
      for (const cmd of due) {
        applyCommand(this.world, player.dotId, cmd);
        player.ackSeq = Math.max(player.ackSeq, cmd.seq);
      }
    }
    step(this.world);
    const events = drainEvents(this.world);
    for (const player of this.players.values()) {
      for (const e of events) {
        const target = this.world.dots.get(e.target);
        const mine = "source" in e && e.source === player.dotId;
        if (mine || (target && isVisibleTo(this.world, target, player.side))) player.events.push(e);
      }
    }

    if (this.world.winner !== null) {
      this.restartIn ??= RESTART_AFTER;
      this.restartIn -= 1 / TICK_RATE;
      if (this.restartIn <= 0) {
        this.restartIn = null;
        resetMatch(this.world);
      }
    }

    if (this.world.tick >= this.nextSnapshotTick) {
      this.nextSnapshotTick += TICK_RATE / this.snapshotRate;
      for (const [ws, player] of this.players) {
        this.send(ws, { t: "snapshot", snap: snapshot(this.world, player, player.ackSeq, player.events) });
        player.events = [];
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
