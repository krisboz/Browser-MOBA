import type { BalanceData } from "@moba/balance";
import type { Command, Side, Snapshot } from "@moba/protocol";
import { DT } from "./tick.js";

export interface Vec {
  x: number;
  y: number;
}

export interface Dot {
  id: string;
  side: Side;
  pos: Vec;
  moveTarget: Vec | null;
}

export interface World {
  balance: BalanceData;
  tick: number;
  dots: Map<string, Dot>;
}

export function createWorld(balance: BalanceData): World {
  return { balance, tick: 0, dots: new Map() };
}

/** Spawn point in the middle of a side's base. Side 0 is at x = 0, side 1 at the far end. */
export function spawnPoint(balance: BalanceData, side: Side): Vec {
  const { length, width, baseDepth } = balance.map;
  return { x: side === 0 ? baseDepth / 2 : length - baseDepth / 2, y: width / 2 };
}

export function addDot(world: World, id: string, side: Side, pos: Vec = spawnPoint(world.balance, side)): Dot {
  const dot: Dot = { id, side, pos: { ...pos }, moveTarget: null };
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
      dot.moveTarget = clampToMap(world.balance, cmd.to);
      break;
  }
}

/** Advances the world by exactly one fixed tick. */
export function step(world: World): void {
  for (const dot of world.dots.values()) moveDot(world.balance, dot);
  world.tick++;
}

function moveDot(balance: BalanceData, dot: Dot): void {
  const target = dot.moveTarget;
  if (!target) return;
  const dx = target.x - dot.pos.x;
  const dy = target.y - dot.pos.y;
  const dist = Math.hypot(dx, dy);
  const stride = balance.dot.moveSpeed * DT;
  if (dist <= stride) {
    dot.pos = { ...target };
    dot.moveTarget = null;
    return;
  }
  dot.pos = { x: dot.pos.x + (dx / dist) * stride, y: dot.pos.y + (dy / dist) * stride };
}

// Until M1 adds walls and pathing, the lane rectangle is the only obstacle.
function clampToMap(balance: BalanceData, p: Vec): Vec {
  const r = balance.dot.radius;
  return {
    x: Math.min(Math.max(p.x, r), balance.map.length - r),
    y: Math.min(Math.max(p.y, r), balance.map.width - r),
  };
}

export function snapshot(world: World, ackSeq: number): Snapshot {
  return {
    tick: world.tick,
    ackSeq,
    dots: [...world.dots.values()].map((d) => ({ id: d.id, side: d.side, x: d.pos.x, y: d.pos.y })),
  };
}
