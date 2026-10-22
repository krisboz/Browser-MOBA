import type { BalanceData } from "@moba/balance";
import { buildGeometry, dist, isClear } from "./geometry.js";
import { findPath, NavGrid } from "./nav.js";

/** Problems that make a map unplayable: blocked spawns, or no way from one base to the other. */
export function validateMap(balance: BalanceData): string[] {
  const g = buildGeometry(balance);
  const r = balance.dot.radius;
  const issues: string[] = [];
  g.spawns.forEach((s, side) => {
    if (!isClear(g, s, r)) issues.push(`map: side ${side} spawn (${s.x}, ${s.y}) is blocked`);
  });
  if (issues.length) return issues;
  const nav = new NavGrid(g, r);
  const path = findPath(nav, g.spawns[0], g.spawns[1]);
  const end = path.at(-1);
  if (!end || dist(end, g.spawns[1]) > 1e-6) issues.push("map: no path from one base to the other");
  return issues;
}
