import { seedV1 } from "@moba/balance";
import type pg from "pg";

/** Inserts the v0 numbers as version 1 and makes it active, if no balance version exists yet. */
export async function seed(pool: pg.Pool): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO balance_versions (note, data, is_active)
     SELECT 'v0 placeholder numbers from the design notes', $1, true
     WHERE NOT EXISTS (SELECT 1 FROM balance_versions)`,
    [JSON.stringify(seedV1)],
  );
  return rowCount === 1;
}
