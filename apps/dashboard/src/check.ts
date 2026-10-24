import { parseBalance, type BalanceData } from "@moba/balance";
import { validateMap } from "@moba/sim";

export type Checked = { ok: true; data: BalanceData } | { ok: false; issues: string[] };

/** The same checks the game server makes before it will run a version: the schema, then a playable map. */
export function checkBalance(input: unknown): Checked {
  const parsed = parseBalance(input);
  if (!parsed.ok) return parsed;
  const issues = validateMap(parsed.data);
  return issues.length ? { ok: false, issues } : parsed;
}
