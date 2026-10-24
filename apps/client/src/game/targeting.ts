import type { DotSnapshot } from "@moba/protocol";

type Point = { x: number; y: number };

/** The enemy whose body (plus `slop`) is under `p`, nearest first; null if none. */
export function enemyUnder(enemies: readonly DotSnapshot[], p: Point, reach: number): DotSnapshot | null {
  let best: DotSnapshot | null = null;
  let bestDist = reach;
  for (const d of enemies) {
    const dd = Math.hypot(d.x - p.x, d.y - p.y);
    if (dd <= bestDist) {
      best = d;
      bestDist = dd;
    }
  }
  return best;
}

/** The enemy nearest to `p`, however far; null when no enemy is in sight. */
export function closestEnemy(enemies: readonly DotSnapshot[], p: Point): DotSnapshot | null {
  return enemyUnder(enemies, p, Infinity);
}
