import { parseBalance, type BalanceData } from "@moba/balance";
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
  if (!result.ok) {
    throw new BalanceLoadError(`balance version ${row.id} is invalid:\n  ${result.issues.join("\n  ")}`);
  }
  return { id: row.id, data: result.data };
}
