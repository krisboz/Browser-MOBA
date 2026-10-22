import type { BalanceData } from "@moba/balance";
import type { Command, Side, Snapshot } from "@moba/protocol";
import { addDot, applyCommand, createWorld, step, type Dot, type Vec, type World } from "@moba/sim";

/**
 * Runs your own dot ahead of the server with the shared rules, so a click moves it on the next frame.
 * Each snapshot resets it to the server's state and replays the commands the server hasn't applied yet.
 * Only your own movement is predicted; everything else waits for the server.
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

  constructor(balance: BalanceData, readonly dotId: string, side: Side, tick: number, pos: Vec) {
    this.world = createWorld(balance);
    this.world.tick = tick;
    this.dot = addDot(this.world, dotId, side, pos);
    this.prev = { ...pos };
  }

  get tick(): number {
    return this.world.tick;
  }

  get pos(): Vec {
    return this.dot.pos;
  }

  get path(): readonly Vec[] {
    return this.dot.path;
  }

  /** Applies a command now and returns it tagged with this tick, ready to send. */
  issue(body: { type: "move"; seq: number; to: Vec }): Command {
    const cmd: Command = { ...body, tick: this.world.tick };
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

    this.dot.pos = { x: snap.self.x, y: snap.self.y };
    this.dot.path = snap.self.path.map((p) => ({ ...p }));
    this.world.tick = snap.tick;
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
