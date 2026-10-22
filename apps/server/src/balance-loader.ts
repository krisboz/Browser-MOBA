import { parseBalance, type BalanceData } from "@moba/balance";
import { validateMap } from "@moba/sim";
import type pg from "pg";

export interface BalanceVersion {
  id: number;
  data: BalanceData;
}

export class BalanceLoadError extends Error {}

/** Loads and validates the active balance version. Throws if there is none or it is invalid. */
export async function loadActiveBalance(pool: pg.Pool): Promise<BalanceVersion> {
  const { rows } = await pool.query<{ id: number; data: unknown }>(
    "SELECT id, data FROM balance_versions WHERE is_active",
  );
  const row = rows[0];
  if (!row) throw new BalanceLoadError("no active balance version (run pnpm db:seed)");
  const result = parseBalance(row.data);
  const issues = result.ok ? validateMap(result.data) : result.issues;
  if (!result.ok || issues.length) {
    throw new BalanceLoadError(`balance version ${row.id} is invalid:\n  ${issues.join("\n  ")}`);
  }
  return { id: row.id, data: result.data };
}
