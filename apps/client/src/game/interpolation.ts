import type { DotSnapshot, Snapshot } from "@moba/protocol";

/**
 * Keeps recent snapshots and draws the world slightly in the past, blending between the two
 * snapshots around that moment. Works in seconds, so it is independent of refresh rate.
 */
export class SnapshotBuffer {
  private snaps: { time: number; snap: Snapshot }[] = [];
  // Smallest (arrival time - server time) seen: the best guess of the clock offset.
  private offset = Infinity;

  constructor(
    private readonly tickRate: number,
    private readonly delay: number,
  ) {}

  push(snap: Snapshot, now: number): void {
    const time = snap.tick / this.tickRate;
    this.offset = Math.min(this.offset, now - time);
    this.snaps.push({ time, snap });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  get latest(): Snapshot | undefined {
    return this.snaps.at(-1)?.snap;
  }

  /** Dot positions at real time `now` (seconds). */
  sample(now: number): DotSnapshot[] {
    const first = this.snaps[0];
    if (!first) return [];
    const t = now - this.offset - this.delay;
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i]!.time > t) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1];
    if (!b || t <= a.time) return a.snap.dots;
    const k = Math.min(1, (t - a.time) / (b.time - a.time));
    return b.snap.dots.map((d) => {
      const prev = a.snap.dots.find((p) => p.id === d.id);
      return prev ? { ...d, x: prev.x + (d.x - prev.x) * k, y: prev.y + (d.y - prev.y) * k } : d;
    });
  }
}
