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

/**
 * Publishes the seed's numbers as a new balance version and makes it active, leaving older versions (and the
 * matches that point at them) as they were. Does nothing if the active version already has these numbers.
 * Returns the new version's id, or null. A stopgap until the owner dashboard (M5) applies changes.
 */
export async function publishSeed(pool: pg.Pool, note: string): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number; same: boolean }>(
      "SELECT id, data = $1::jsonb AS same FROM balance_versions WHERE is_active FOR UPDATE",
      [JSON.stringify(seedV1)],
    );
    const active = rows[0];
    if (active?.same) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("UPDATE balance_versions SET is_active = false WHERE is_active");
    const inserted = await client.query<{ id: number }>(
      "INSERT INTO balance_versions (note, parent_id, data, is_active) VALUES ($1, $2, $3, true) RETURNING id",
      [note, active?.id ?? null, JSON.stringify(seedV1)],
    );
    await client.query("COMMIT");
    return inserted.rows[0]!.id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
