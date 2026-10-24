import { STAT_KEYS, type BalanceData } from "@moba/balance";
import type { Loadout } from "@moba/protocol";

export interface Stats {
  maxHealth: number;
  attack: number;
  /** Attacks per second. */
  attackSpeed: number;
  magicAttack: number;
  armor: number;
  magicResist: number;
  /** Base movement speed, before any bonus. */
  moveSpeed: number;
  /** Movement speed bonus from items, as a share (0.15 is +15%). Buffs add to it; see effectiveStats. */
  moveBonus: number;
  range: number;
}

/** A dot's stats: the vanilla base, plus its points, plus the items it has bought (by id). */
export function computeStats(balance: BalanceData, loadout: Loadout, items: readonly string[] = []): Stats {
  const line = balance.dot.stats;
  const value = (key: (typeof STAT_KEYS)[number]) => line[key].base + line[key].perPoint * (loadout.points[key] ?? 0);
  const stats: Stats = {
    maxHealth: value("health"),
    attack: value("attack"),
    attackSpeed: value("attackSpeed"),
    magicAttack: value("magicAttack"),
    armor: value("armor"),
    magicResist: value("magicResist"),
    moveSpeed: balance.dot.moveSpeed,
    moveBonus: 0,
    range: balance.dot.range[loadout.range],
  };
  for (const id of items) {
    const bonus = balance.items.find((i) => i.id === id)?.stats ?? {};
    stats.maxHealth += bonus.health ?? 0;
    for (const key of STAT_KEYS) if (key !== "health") stats[key] += bonus[key] ?? 0;
    stats.moveBonus += bonus.moveSpeedPct ?? 0;
  }
  return stats;
}

/** A minion's stats, from its line in the balance. */
export function minionStats(balance: BalanceData, range: "melee" | "ranged"): Stats {
  const m = balance.minions[range];
  return { maxHealth: m.health, attack: m.damage, attackSpeed: m.attackSpeed, magicAttack: 0, armor: 0, magicResist: 0, moveSpeed: m.moveSpeed, moveBonus: 0, range: m.range };
}

export function towerStats(balance: BalanceData): Stats {
  const t = balance.towers;
  return { maxHealth: t.health, attack: t.damage, attackSpeed: t.attackSpeed, magicAttack: 0, armor: 0, magicResist: 0, moveSpeed: 0, moveBonus: 0, range: t.range };
}

/** Problems with a point spread: over the per-stat cap, over the budget, or not whole points. */
export function pointIssues(balance: BalanceData, points: Loadout["points"]): string[] {
  const issues: string[] = [];
  let total = 0;
  for (const [stat, n] of Object.entries(points)) {
    if (!Number.isInteger(n) || n < 0) issues.push(`${stat}: ${n} is not a whole number of points`);
    else if (n > balance.dot.pointCapPerStat) issues.push(`${stat}: ${n} points is over the cap of ${balance.dot.pointCapPerStat}`);
    total += n;
  }
  if (total > balance.dot.pointBudget) issues.push(`${total} points is over the budget of ${balance.dot.pointBudget}`);
  return issues;
}

/** Resolves a loadout by preset id, or "vanilla" / "vanilla-melee" for a dot with no points. */
export function loadoutFor(balance: BalanceData, preset: string | undefined): Loadout | null {
  const none = { abilities: { Q: null, W: null, E: null, R: null }, summoners: [null, null] as [null, null] };
  if (preset === "vanilla" || preset === "vanilla-ranged") return { preset: null, range: "ranged", points: {}, ...none };
  if (preset === "vanilla-melee") return { preset: null, range: "melee", points: {}, ...none };
  const p = preset === undefined ? balance.presets[0] : balance.presets.find((x) => x.id === preset);
  return p ? { preset: p.id, range: p.range, points: { ...p.points }, abilities: { ...p.abilities }, summoners: [...p.summoners] } : null;
}

/** Damage taken = damage x k / (k + resist), with k from the balance (100: 100 resist halves damage). */
export function mitigate(balance: BalanceData, raw: number, resist: number): number {
  const k = balance.damage.resistConstant;
  return (raw * k) / (k + Math.max(0, resist));
}

/** Seconds between attack starts. */
export const attackInterval = (stats: Stats) => 1 / stats.attackSpeed;
