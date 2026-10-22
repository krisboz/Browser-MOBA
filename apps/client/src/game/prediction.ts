import type { BalanceData } from "@moba/balance";
import type { Command, Loadout, SelfState, Side, Snapshot } from "@moba/protocol";
import { addDot, applyCommand, applySelfState, createWorld, removeDot, step, type Dot, type Vec, type World } from "@moba/sim";

type CommandBody = Command extends infer C ? (C extends Command ? Omit<C, "tick"> : never) : never;

const GHOST: Loadout = { preset: null, range: "ranged", points: {} };

/**
 * Runs your own dot ahead of the server with the shared rules, so a click moves it on the next frame.
 * Each snapshot resets it to the server's state and replays the commands the server hasn't applied yet.
 * Other visible dots are copied in as still "ghosts", so chasing an attack target walks the right way.
 * Only your own movement is drawn from here; wind-ups, hits and everyone else come from the server.
 */
export class Predictor {
  readonly world: World;
  private readonly dot: Dot;
  private pending: Command[] = [];
  private prev: Vec;
  /** Visual offset left over from corrections; fades out so a correction never shows as a jump. */
  private offset: Vec = { x: 0, y: 0 };
  /** Size of the last correction, in units. 0 when the prediction was right. */
  lastCorrection = 0;

  constructor(balance: BalanceData, readonly dotId: string, side: Side, loadout: Loadout, tick: number, self: SelfState) {
    this.world = createWorld(balance);
    this.world.tick = tick;
    this.dot = addDot(this.world, { id: dotId, side, loadout });
    applySelfState(this.dot, self);
    this.prev = { ...this.dot.pos };
  }

  get tick(): number {
    return this.world.tick;
  }

  get pos(): Vec {
    return this.dot.pos;
  }

  get facing(): number {
    return this.dot.facing;
  }

  get path(): readonly Vec[] {
    return this.dot.path;
  }

  /** Applies a command now and returns it tagged with this tick, ready to send. */
  issue(body: CommandBody): Command {
    const cmd = { ...body, tick: this.world.tick } as Command;
    this.pending.push(cmd);
    applyCommand(this.world, this.dotId, cmd);
    return cmd;
  }

  step(): void {
    this.prev = { ...this.dot.pos };
    step(this.world);
  }

  /** Moves the clock without simulating, when it has drifted too far from where it should be. */
  jumpTo(tick: number): void {
    this.world.tick = tick;
  }

  reconcile(snap: Snapshot): void {
    if (!snap.self) return;
    this.pending = this.pending.filter((c) => c.seq > snap.ackSeq);
    const before = { ...this.dot.pos };
    const prevBefore = { ...this.prev };
    const until = Math.max(this.world.tick, snap.tick);
    const replayed = until > snap.tick;

    this.syncGhosts(snap);
    applySelfState(this.dot, snap.self);
    this.world.tick = snap.tick;
    this.world.score = [...snap.score];
    this.world.winner = snap.winner;
    this.world.projectiles = [];

    let next = 0;
    const applyDue = () => {
      while (next < this.pending.length && this.pending[next]!.tick <= this.world.tick) {
        applyCommand(this.world, this.dotId, this.pending[next++]!);
      }
    };
    while (this.world.tick < until) {
      applyDue();
      this.prev = { ...this.dot.pos };
      step(this.world);
    }
    applyDue();
    // Anything tagged later than now (the clock jumped back) still applies, just from here.
    while (next < this.pending.length) applyCommand(this.world, this.dotId, this.pending[next++]!);

    const error = { x: before.x - this.dot.pos.x, y: before.y - this.dot.pos.y };
    this.lastCorrection = Math.hypot(error.x, error.y);
    this.offset = { x: this.offset.x + error.x, y: this.offset.y + error.y };
    // With nothing replayed, `prev` is still from the old timeline; shift it by the same correction.
    if (!replayed) this.prev = { x: prevBefore.x - error.x, y: prevBefore.y - error.y };
  }

  private syncGhosts(snap: Snapshot): void {
    const seen = new Set<string>([this.dotId]);
    for (const d of snap.dots) {
      if (d.id === this.dotId) continue;
      seen.add(d.id);
      const ghost = this.world.dots.get(d.id) ?? addDot(this.world, { id: d.id, side: d.side, loadout: GHOST, dummy: d.dummy });
      ghost.pos = { x: d.x, y: d.y };
      ghost.path = [];
      ghost.patrol = null;
      ghost.attackTarget = null;
      ghost.windUp = null;
      ghost.alive = d.alive;
      ghost.health = d.health;
      ghost.stats.maxHealth = d.maxHealth;
      ghost.revealedFor = 0;
    }
    for (const id of [...this.world.dots.keys()]) if (!seen.has(id)) removeDot(this.world, id);
  }

  /** Where to draw the dot: between the last two ticks, plus whatever correction is still fading. */
  renderPos(alpha: number, dt: number): Vec {
    const fade = Math.exp(-dt / 0.06);
    this.offset = { x: this.offset.x * fade, y: this.offset.y * fade };
    if (Math.hypot(this.offset.x, this.offset.y) < 0.01) this.offset = { x: 0, y: 0 };
    return {
      x: this.prev.x + (this.dot.pos.x - this.prev.x) * alpha + this.offset.x,
      y: this.prev.y + (this.dot.pos.y - this.prev.y) * alpha + this.offset.y,
    };
  }
}
