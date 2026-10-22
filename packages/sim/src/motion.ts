import { dist, isClear, pushOut, type Vec } from "./geometry.js";
import { DT } from "./tick.js";
import type { Dot, Motion, World } from "./types.js";
import { spawnLandingArea } from "./spells.js";

// Step for walking a line looking for walls; small enough that a dot can't slip through a corner.
const PROBE = 4;

/** Starts a movement. The newest always wins: whatever was in progress (a dash, a pull, a push) stops. */
export function setMotion(dot: Dot, motion: Motion | null): void {
  dot.motion = motion;
}

/**
 * The furthest point toward `to` a dot can reach in a straight line.
 * Through walls: the landing nearest `to` found by stepping back along the line (the Flash rule).
 * Not through walls: it stops before the first wall.
 */
export function clipLine(world: World, from: Vec, to: Vec, crossesWalls: boolean): Vec {
  const r = world.balance.dot.radius;
  const g = world.geometry;
  const d = dist(from, to);
  if (d < 1e-9) return { ...from };
  const n = Math.ceil(d / PROBE);
  const at = (t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  if (crossesWalls) {
    for (let i = n; i >= 0; i--) {
      const p = at(i / n);
      if (isClear(g, p, r)) return p;
    }
    return { ...from };
  }
  for (let i = 1; i <= n; i++) {
    if (isClear(g, at(i / n), r)) continue;
    // Narrow down to the exact edge between the last clear step and this blocked one.
    let lo = (i - 1) / n;
    let hi = i / n;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (isClear(g, at(mid), r)) lo = mid;
      else hi = mid;
    }
    return at(lo);
  }
  return { ...to };
}

/** Point `range` at most from `from`, toward `aim`. */
export function clampToRange(from: Vec, aim: Vec, range: number): Vec {
  const d = dist(from, aim);
  if (d <= range) return { ...aim };
  return { x: from.x + ((aim.x - from.x) / d) * range, y: from.y + ((aim.y - from.y) / d) * range };
}

export function stepMotion(world: World, dot: Dot): void {
  const m = dot.motion;
  if (!m) return;
  const stride = m.speed * DT;
  if (m.kind === "pull") {
    const to = world.dots.get(m.toward);
    if (!to || !to.alive) {
      dot.motion = null;
      return settle(world, dot);
    }
    const touch = world.balance.dot.radius * 2;
    const d = dist(dot.pos, to.pos);
    if (d - stride <= touch) {
      if (d > 1e-9) dot.pos = { x: to.pos.x + ((dot.pos.x - to.pos.x) / d) * touch, y: to.pos.y + ((dot.pos.y - to.pos.y) / d) * touch };
      dot.motion = null;
    } else {
      dot.pos = { x: dot.pos.x + ((to.pos.x - dot.pos.x) / d) * stride, y: dot.pos.y + ((to.pos.y - dot.pos.y) / d) * stride };
    }
    return settle(world, dot);
  }
  const d = dist(dot.pos, m.to);
  if (d > 1e-9 && m.kind !== "knockback") dot.facing = Math.atan2(m.to.y - dot.pos.y, m.to.x - dot.pos.x);
  if (d <= stride) {
    dot.pos = { ...m.to };
    dot.motion = null;
    if (m.kind !== "knockback" && m.ctx) for (const area of m.onLand) spawnLandingArea(world, m.ctx, dot.pos, area);
  } else {
    dot.pos = { x: dot.pos.x + ((m.to.x - dot.pos.x) / d) * stride, y: dot.pos.y + ((m.to.y - dot.pos.y) / d) * stride };
  }
  settle(world, dot);
}

/** A pull can drag a dot over a wall; wherever a movement leaves it, it ends up standing somewhere legal. */
function settle(world: World, dot: Dot): void {
  const r = world.balance.dot.radius;
  if (!dot.motion && !isClear(world.geometry, dot.pos, r)) dot.pos = pushOut(world.geometry, dot.pos, r);
}
