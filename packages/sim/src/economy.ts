import type { BalanceData } from "@moba/balance";
import type { CastSlot, Side } from "@moba/protocol";
import type { Vec } from "./geometry.js";
import { computeStats } from "./stats.js";
import { DT, TICK_RATE } from "./tick.js";
import type { Dot, World } from "./types.js";

/** Seconds since the current match started. */
export const matchTime = (world: World) => (world.tick - world.matchStartTick) / TICK_RATE;

/** Standing in your own base: where you heal and where the shop is. A dot is in base when its centre is. */
export function inOwnBase(world: World, dot: Dot): boolean {
  const depth = world.balance.map.baseDepth;
  return dot.side === 0 ? dot.pos.x <= depth : dot.pos.x >= world.geometry.length - depth;
}

/** The level a total of `xp` experience reaches. */
export function levelFor(balance: BalanceData, xp: number): number {
  return Math.min(balance.levels.maxLevel, 1 + Math.floor(xp / balance.levels.xpPerLevel + 1e-9));
}

/** Experience into the current level, for the HUD. */
export function xpIntoLevel(balance: BalanceData, dot: Dot): number {
  return dot.xp - (dot.level - 1) * balance.levels.xpPerLevel;
}

/** A slot's cooldown at a level: every level past the first cuts ability cooldowns. Summoners keep theirs. */
export function levelledCooldown(balance: BalanceData, level: number, slot: CastSlot, base: number): number {
  if (slot === "D" || slot === "F") return base;
  return base * Math.max(0, 1 - balance.levels.cooldownCutPerLevel * (level - 1));
}

/** R stays locked until the unlock level. */
export const slotUnlocked = (balance: BalanceData, dot: Dot, slot: CastSlot) => slot !== "R" || dot.level >= balance.levels.ultimateUnlockLevel;

export function grantXp(world: World, dot: Dot, amount: number): void {
  if (dot.kind !== "dot" || amount <= 0) return;
  dot.xp += amount;
  const level = levelFor(world.balance, dot.xp);
  if (level <= dot.level) return;
  dot.level = level;
  world.events.push({ kind: "level", tick: world.tick, target: dot.id, level, x: dot.pos.x, y: dot.pos.y });
}

export function grantGold(world: World, dot: Dot, amount: number, at: Vec): void {
  if (dot.kind !== "dot" || amount <= 0) return;
  dot.gold += amount;
  dot.goldEarned += amount;
  world.events.push({ kind: "gold", tick: world.tick, target: dot.id, amount, x: at.x, y: at.y });
}

/**
 * What a death pays. A minion pays its last hitter; a dot pays its killer, more when the killer is behind; a tower pays
 * every dot on the side that brought it down. A kill by a minion or tower pays nobody. Runs before the kill is counted.
 */
export function payForKill(world: World, victim: Dot, sourceId: string, sourceSide: Side): void {
  const gold = world.balance.gold;
  const xp = world.balance.levels.xp;
  const source = world.dots.get(sourceId);
  const killer = source?.kind === "dot" ? source : null;
  switch (victim.kind) {
    case "minion":
      if (!killer) return;
      grantGold(world, killer, gold.lastHit, victim.pos);
      grantXp(world, killer, xp.minion);
      return;
    case "dot": {
      if (!killer) return;
      const deathsBehind = Math.max(0, killer.deaths - killer.kills);
      grantGold(world, killer, gold.kill * (1 + gold.comebackPerDeathBehind * deathsBehind), victim.pos);
      grantXp(world, killer, xp.kill);
      return;
    }
    case "tower":
      for (const d of world.dots.values()) {
        if (d.kind !== "dot" || d.side !== sourceSide) continue;
        grantGold(world, d, gold.tower, victim.pos);
        grantXp(world, d, xp.tower);
      }
      return;
  }
}

/** Everyone's gold goes up a little every tick, dead or alive. */
export function stepTrickle(world: World): void {
  const amount = world.balance.gold.perSecond * DT;
  for (const d of world.dots.values()) {
    if (d.kind !== "dot") continue;
    d.gold += amount;
    d.goldEarned += amount;
  }
}

/** Buys an item, if the dot is in its own base (or dead), can pay, and has a free slot. Returns whether it did. */
export function buy(world: World, dot: Dot, itemId: string): boolean {
  const item = world.balance.items.find((i) => i.id === itemId);
  if (!item || dot.kind !== "dot" || world.winner !== null) return false;
  if (dot.alive && !inOwnBase(world, dot)) return false;
  if (dot.gold < item.cost - 1e-9 || dot.items.length >= world.balance.shop.inventorySlots) return false;
  dot.gold -= item.cost;
  dot.items.push({ id: item.id, at: matchTime(world) });
  const before = dot.stats.maxHealth;
  dot.stats = computeStats(world.balance, dot.loadout, dot.items.map((i) => i.id));
  // Bought health comes with the health to fill it.
  if (dot.alive) dot.health += dot.stats.maxHealth - before;
  return true;
}

/** Back to the start of a match: starting gold, level 1, no items. */
export function resetEconomy(world: World, dot: Dot): void {
  dot.gold = dot.goldEarned = dot.kind === "dot" ? world.balance.gold.start : 0;
  dot.xp = 0;
  dot.level = 1;
  dot.items = [];
  dot.killTimes = [];
  if (dot.kind === "dot") dot.stats = computeStats(world.balance, dot.loadout);
}
