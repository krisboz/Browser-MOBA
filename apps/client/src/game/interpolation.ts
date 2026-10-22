import type { DotSnapshot, ProjectileSnapshot, Snapshot } from "@moba/protocol";

// Seconds per snapshot: 2 ms, so at 20 snapshots/s a latency rise is followed at 40 ms per second.
const OFFSET_CREEP = 0.002;

export interface Sample {
  /** Server time being drawn, in seconds. */
  time: number;
  dots: DotSnapshot[];
  projectiles: ProjectileSnapshot[];
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/**
 * Keeps recent snapshots and draws the world slightly in the past, blending between the two
 * snapshots around that moment. Works in seconds, so it is independent of refresh rate.
 */
export class SnapshotBuffer {
  private snaps: { time: number; snap: Snapshot }[] = [];
  // Smallest recent (arrival time - server time): the best guess of the clock offset. It creeps up slowly
  // so it can follow latency that rises (a worse connection, or the lag switch turned up).
  private offset = Infinity;

  constructor(
    private readonly tickRate: number,
    private readonly delay: number,
  ) {}

  push(snap: Snapshot, now: number): void {
    const time = snap.tick / this.tickRate;
    this.offset = Math.min(this.offset + OFFSET_CREEP, now - time);
    this.snaps.push({ time, snap });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  get latest(): Snapshot | undefined {
    return this.snaps.at(-1)?.snap;
  }

  /** The world as drawn at real time `now` (seconds). */
  sample(now: number): Sample {
    const t = now - this.offset - this.delay;
    const first = this.snaps[0];
    if (!first) return { time: t, dots: [], projectiles: [] };
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i]!.time > t) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1];
    if (!b || t <= a.time) return { time: t, dots: a.snap.dots, projectiles: a.snap.projectiles };
    const k = Math.min(1, (t - a.time) / (b.time - a.time));
    const dots = b.snap.dots.map((d) => {
      const p = a.snap.dots.find((x) => x.id === d.id);
      // Don't slide a dot across the map when it respawns.
      if (!p || p.alive !== d.alive) return d;
      return {
        ...d,
        x: lerp(p.x, d.x, k),
        y: lerp(p.y, d.y, k),
        facing: lerpAngle(p.facing, d.facing, k),
        health: lerp(p.health, d.health, k),
        windUp: p.windUp !== null && d.windUp !== null ? lerp(p.windUp, d.windUp, k) : k < 0.5 ? p.windUp : d.windUp,
      };
    });
    const projectiles = b.snap.projectiles.map((q) => {
      const p = a.snap.projectiles.find((x) => x.id === q.id);
      return p ? { ...q, x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) } : q;
    });
    return { time: t, dots, projectiles };
  }
}
