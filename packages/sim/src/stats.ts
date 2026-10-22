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
  moveSpeed: number;
  range: number;
}

/** A dot's stats from the vanilla base plus its points. Items join in M4. */
export function computeStats(balance: BalanceData, loadout: Loadout): Stats {
  const line = balance.dot.stats;
  const value = (key: (typeof STAT_KEYS)[number]) => line[key].base + line[key].perPoint * (loadout.points[key] ?? 0);
  return {
    maxHealth: value("health"),
    attack: value("attack"),
    attackSpeed: value("attackSpeed"),
    magicAttack: value("magicAttack"),
    armor: value("armor"),
    magicResist: value("magicResist"),
    moveSpeed: balance.dot.moveSpeed,
    range: balance.dot.range[loadout.range],
  };
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
  if (preset === "vanilla" || preset === "vanilla-ranged") return { preset: null, range: "ranged", points: {} };
  if (preset === "vanilla-melee") return { preset: null, range: "melee", points: {} };
  const p = preset === undefined ? balance.presets[0] : balance.presets.find((x) => x.id === preset);
  return p ? { preset: p.id, range: p.range, points: { ...p.points } } : null;
}

/** Damage taken = damage x k / (k + resist), with k from the balance (100: 100 resist halves damage). */
export function mitigate(balance: BalanceData, raw: number, resist: number): number {
  const k = balance.damage.resistConstant;
  return (raw * k) / (k + Math.max(0, resist));
}

/** Seconds between attack starts. */
export const attackInterval = (stats: Stats) => 1 / stats.attackSpeed;
