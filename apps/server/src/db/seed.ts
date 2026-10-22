import { seedV1 } from "@moba/balance";
import type pg from "pg";

export class SeedError extends Error {}

/**
 * Inserts the v0 numbers as version 1 and makes it active, if no balance version exists yet.
 * With `replace`, first deletes every balance version: a development tool for when the balance schema
 * changes before any match has been played. Refuses once matches exist, because they point at their version.
 */
export async function seed(pool: pg.Pool, { replace = false } = {}): Promise<boolean> {
  if (replace) {
    const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM matches");
    if (Number(rows[0]!.n) > 0) throw new SeedError("matches exist, so balance versions can't be replaced; add a new version instead");
    await pool.query("TRUNCATE balance_versions RESTART IDENTITY CASCADE");
  }
  const { rowCount } = await pool.query(
    `INSERT INTO balance_versions (note, data, is_active)
     SELECT 'v0 placeholder numbers from the design notes', $1, true
     WHERE NOT EXISTS (SELECT 1 FROM balance_versions)`,
    [JSON.stringify(seedV1)],
  );
  return rowCount === 1;
}
