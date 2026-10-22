import { STAT_KEYS } from "@moba/balance";
import type { Stats } from "./stats.js";
import type { Dot, Status, World } from "./types.js";

export const isStunned = (dot: Dot) => dot.statuses.some((s) => s.kind === "stun");
export const isRooted = (dot: Dot) => dot.statuses.some((s) => s.kind === "root");
export const isInvisible = (dot: Dot) => dot.statuses.some((s) => s.kind === "invisible");

/** Walking needs: not stunned, rooted, anchored, channelling, winding up a spell, or being moved some other way. */
export function canWalk(dot: Dot): boolean {
  return !isStunned(dot) && !isRooted(dot) && dot.anchoredBy === null && !dot.channel && !dot.cast && !dot.motion;
}

/**
 * Adds a status. A stun stops everything in progress; a root stops a dash or leap in progress.
 * Being pushed or pulled is not stopped by either: that isn't the dot acting.
 */
export function addStatus(world: World, dot: Dot, status: Status): void {
  if (status.kind === "slow") {
    // The same slow re-applied (a lasting area, every tick) refreshes instead of stacking up.
    const same = dot.statuses.find((s) => s.kind === "slow" && s.amount === status.amount);
    if (same) {
      same.remaining = Math.max(same.remaining, status.remaining);
      return;
    }
  }
  if (status.kind === "empowered" || status.kind === "spellShield" || status.kind === "barrier") {
    dot.statuses = dot.statuses.filter((s) => s.kind !== status.kind);
  }
  if (status.kind === "mark") dot.statuses = dot.statuses.filter((s) => !(s.kind === "mark" && s.source === status.source));
  if (status.kind === "buff") dot.statuses = dot.statuses.filter((s) => !(s.kind === "buff" && s.ability === status.ability));
  dot.statuses.push(status);

  if (status.kind === "root" || status.kind === "stun") {
    if (dot.motion && (dot.motion.kind === "dash" || dot.motion.kind === "leap")) dot.motion = null;
  }
  if (status.kind === "stun") interrupt(dot);
}

/** Cancels whatever the dot was doing: wind-ups (refunded, nothing fires), a spell wind-up, a channel. */
export function interrupt(dot: Dot): void {
  if (dot.windUp) {
    dot.windUp = null;
    dot.attackReadyIn = 0;
  }
  dot.cast = null;
  dot.channel = null;
}

export function tickStatuses(dot: Dot, dt: number): void {
  for (const s of dot.statuses) s.remaining -= dt;
  dot.statuses = dot.statuses.filter((s) => s.remaining > 1e-9 && !(s.kind === "barrier" && s.amount <= 1e-9));
}

/** Stats with buffs and slows applied. Movement speed: bonuses capped, then slowed. */
export function effectiveStats(world: World, dot: Dot): Stats {
  const out: Stats = { ...dot.stats };
  let moveBonus = 0;
  let slow = 0;
  for (const s of dot.statuses) {
    if (s.kind === "slow") slow = Math.max(slow, s.amount);
    if (s.kind !== "buff") continue;
    const k = s.fades ? Math.max(0, s.remaining / s.duration) : 1;
    for (const key of STAT_KEYS) {
      const v = s.stats[key];
      if (v === undefined) continue;
      if (key === "health") out.maxHealth += v * k;
      else out[key] += v * k;
    }
    moveBonus += (s.stats.moveSpeedPct ?? 0) * k;
  }
  out.moveSpeed = Math.min(world.balance.dot.moveSpeedCap, dot.stats.moveSpeed * (1 + moveBonus)) * (1 - slow);
  return out;
}
