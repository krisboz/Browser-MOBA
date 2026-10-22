import type { BalanceData } from "@moba/balance";
import type { Command, DotSnapshot, SelfState, Side, Snapshot } from "@moba/protocol";
import { buildGeometry, isClear, pushOut, type MapGeometry, type Vec } from "./geometry.js";
import { findPath, NavGrid } from "./nav.js";
import { DT } from "./tick.js";
import { isVisibleTo } from "./vision.js";

export type { Vec } from "./geometry.js";

export interface Dot {
  id: string;
  side: Side;
  pos: Vec;
  /** Remaining waypoints of the current walk; empty when standing still. */
  path: Vec[];
}

export interface World {
  balance: BalanceData;
  geometry: MapGeometry;
  nav: NavGrid;
  tick: number;
  dots: Map<string, Dot>;
}

// Building the nav grid takes a few ms, so each balance record builds it once and every world shares it.
const mapCache = new WeakMap<BalanceData, { geometry: MapGeometry; nav: NavGrid }>();

function mapFor(balance: BalanceData) {
  let cached = mapCache.get(balance);
  if (!cached) {
    const geometry = buildGeometry(balance);
    cached = { geometry, nav: new NavGrid(geometry, balance.dot.radius) };
    mapCache.set(balance, cached);
  }
  return cached;
}

export function createWorld(balance: BalanceData): World {
  return { balance, ...mapFor(balance), tick: 0, dots: new Map() };
}

export function addDot(world: World, id: string, side: Side, pos: Vec = world.geometry.spawns[side]): Dot {
  const dot: Dot = { id, side, pos: { ...pos }, path: [] };
  world.dots.set(id, dot);
  return dot;
}

export function removeDot(world: World, id: string): void {
  world.dots.delete(id);
}

export function applyCommand(world: World, dotId: string, cmd: Command): void {
  const dot = world.dots.get(dotId);
  if (!dot) return;
  switch (cmd.type) {
    case "move":
      dot.path = findPath(world.nav, dot.pos, cmd.to);
      break;
  }
}

/** Advances the world by exactly one fixed tick. */
export function step(world: World): void {
  for (const dot of world.dots.values()) moveDot(world, dot);
  world.tick++;
}

function moveDot(world: World, dot: Dot): void {
  let left = world.balance.dot.moveSpeed * DT;
  while (left > 0 && dot.path.length) {
    const target = dot.path[0]!;
    const dx = target.x - dot.pos.x;
    const dy = target.y - dot.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= left) {
      dot.pos = { ...target };
      dot.path.shift();
      left -= d;
    } else {
      dot.pos = { x: dot.pos.x + (dx / d) * left, y: dot.pos.y + (dy / d) * left };
      left = 0;
    }
  }
  const r = world.balance.dot.radius;
  if (!isClear(world.geometry, dot.pos, r)) dot.pos = pushOut(world.geometry, dot.pos, r);
}

/** What one player may see: everything visible to their side, plus their own dot's full movement state. */
export function snapshot(world: World, viewer: { side: Side; dotId: string | null }, ackSeq: number): Snapshot {
  const dots: DotSnapshot[] = [];
  for (const d of world.dots.values()) {
    if (isVisibleTo(world, d, viewer.side)) dots.push({ id: d.id, side: d.side, x: d.pos.x, y: d.pos.y });
  }
  const own = viewer.dotId ? world.dots.get(viewer.dotId) : undefined;
  const self: SelfState | null = own ? { x: own.pos.x, y: own.pos.y, path: own.path.map((p) => ({ ...p })) } : null;
  return { tick: world.tick, ackSeq, dots, self };
}
