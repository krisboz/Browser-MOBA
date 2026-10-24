import type { Loadout, Side, UnitKind } from "@moba/protocol";
import { clearAttack, inRange } from "./combat.js";
import { stepTrickle } from "./economy.js";
import { dist } from "./geometry.js";
import { findPath } from "./nav.js";
import { canWalk } from "./statuses.js";
import { DT } from "./tick.js";
import type { Dot, World } from "./types.js";
import { isVisibleTo } from "./vision.js";
import { addDot } from "./world.js";

// Gap between minions standing side by side in a fresh wave, across the lane.
const WAVE_SPACING = 45;

/** Minions and towers carry a loadout like any unit: no points, no spells. */
export const unitLoadout = (range: "melee" | "ranged"): Loadout => ({
  preset: null,
  range,
  points: {},
  abilities: { Q: null, W: null, E: null, R: null },
  summoners: [null, null],
});

export const towerId = (side: Side) => `tower${side}`;

export function addTowers(world: World): void {
  world.geometry.towers.forEach((pos, side) => {
    addDot(world, { id: towerId(side as Side), kind: "tower", side: side as Side, loadout: unitLoadout("ranged"), pos });
  });
}

/** One wave per side at its base: melee in front, ranged behind, marching on the other base. */
export function spawnWave(world: World): void {
  const { melee, ranged } = world.balance.minions;
  for (const side of [0, 1] as Side[]) {
    const from = world.geometry.spawns[side];
    const ahead = side === 0 ? 1 : -1;
    const rank = (range: "melee" | "ranged", count: number, forward: number) => {
      for (let i = 0; i < count; i++) {
        const pos = world.nav.nearestStandable({ x: from.x + ahead * forward, y: from.y + (i - (count - 1) / 2) * WAVE_SPACING });
        addDot(world, { id: `m${world.nextId++}`, kind: "minion", side, loadout: unitLoadout(range), pos });
      }
    };
    rank("melee", melee.count, 40);
    rank("ranged", ranged.count, -20);
  }
}

/** The lane's clock, once per tick before anyone acts: waves on time, and the gold trickle. */
export function stepLane(world: World): void {
  world.nextWaveIn -= DT;
  if (world.nextWaveIn <= 1e-9) {
    spawnWave(world);
    world.nextWaveIn += world.balance.minions.waveInterval;
  }
  stepTrickle(world);
}

const attackable = (world: World, unit: Dot, target: Dot | undefined): target is Dot =>
  !!target && target.alive && target.side !== unit.side && isVisibleTo(world, target, unit.side);

/** From a unit's centre to the target's edge, as attack range is measured. */
const gap = (unit: Dot, target: Dot) => dist(unit.pos, target.pos) - target.radius;

function nearest(world: World, unit: Dot, kind: UnitKind, within: number): Dot | undefined {
  let best: Dot | undefined;
  let bestGap = within + 1e-9;
  for (const d of world.dots.values()) {
    if (d.kind !== kind || !attackable(world, unit, d)) continue;
    const g = gap(unit, d);
    if (g <= bestGap) {
      best = d;
      bestGap = g;
    }
  }
  return best;
}

function setTarget(unit: Dot, target: Dot | undefined): void {
  if (unit.attackTarget === (target?.id ?? null)) return;
  clearAttack(unit);
  unit.attackTarget = target?.id ?? null;
  unit.path = [];
  unit.repathIn = 0;
}

// What minions go for, in order, when no dot has drawn them.
const MINION_PRIORITY: UnitKind[] = ["minion", "tower", "dot"];

/**
 * A minion's choice for this tick. A dot that attacked one of its side's dots comes first, for a while. Otherwise the
 * nearest enemy minion, then the tower, then a dot; it sticks with what it is fighting while that is still the best
 * kind of target near, so it doesn't flick between two minions.
 */
export function aimMinion(world: World, m: Dot): void {
  const info = m.minion!;
  const range = world.balance.minions.acquireRange;
  info.aggroFor = Math.max(0, info.aggroFor - DT);
  const aggro = info.aggroOn && info.aggroFor > 0 ? world.dots.get(info.aggroOn) : undefined;
  if (!attackable(world, m, aggro)) info.aggroOn = null;
  let target = info.aggroOn ? aggro : undefined;
  for (const kind of MINION_PRIORITY) {
    if (target) break;
    const best = nearest(world, m, kind, range);
    if (!best) continue;
    const current = m.attackTarget ? world.dots.get(m.attackTarget) : undefined;
    target = current?.kind === kind && attackable(world, m, current) && gap(m, current) <= range ? current : best;
  }
  setTarget(m, target);
  if (!target && !m.path.length && canWalk(m) && dist(m.pos, info.goal) > 1) m.path = findPath(world.nav, m.pos, info.goal);
}

/** A tower keeps shooting what it shoots while that stays in range; then the nearest minion, then a dot. */
export function aimTower(world: World, t: Dot): void {
  const current = t.attackTarget ? world.dots.get(t.attackTarget) : undefined;
  if (attackable(world, t, current) && inRange(world, t, current)) return;
  setTarget(t, nearest(world, t, "minion", t.stats.range) ?? nearest(world, t, "dot", t.stats.range));
}

/**
 * The aggro switch: a dot that hurts an enemy dot draws the victim side's minions near it, and its tower if in range.
 * Minions and towers never pick a dot over a minion otherwise.
 */
export function callForHelp(world: World, attacker: Dot, victim: Dot): void {
  for (const u of world.dots.values()) {
    if (!u.alive || u.side !== victim.side || !attackable(world, u, attacker)) continue;
    if (u.kind === "minion" && gap(u, attacker) <= world.balance.minions.acquireRange) {
      u.minion!.aggroOn = attacker.id;
      u.minion!.aggroFor = world.balance.minions.aggroDuration;
    }
    if (u.kind === "tower" && inRange(world, u, attacker)) setTarget(u, attacker);
  }
}

/** A tower shot hits harder for each shot in a row at the same target. */
export function towerShotDamage(world: World, t: Dot, target: Dot, base: number): number {
  const ramp = t.tower!;
  if (ramp.rampOn === target.id) ramp.hits++;
  else {
    ramp.rampOn = target.id;
    ramp.hits = 0;
  }
  return base * (1 + world.balance.towers.rampPerConsecutiveHit * ramp.hits);
}
