import type pg from "pg";
import { checkBalance } from "./check.js";

export interface VersionSummary {
  id: number;
  createdAt: string;
  note: string;
  parentId: number | null;
  active: boolean;
  /** Matches recorded on this version. */
  matches: number;
}

export interface Version extends VersionSummary {
  data: unknown;
}

export type ApplyResult = { ok: true; id: number } | { ok: false; status: 400 | 404 | 409; issues: string[] };

const SUMMARY = `
  SELECT v.id, v.created_at, v.note, v.parent_id, v.is_active,
         (SELECT count(*) FROM matches m WHERE m.balance_version_id = v.id)::int AS matches`;

type Row = { id: number; created_at: Date; note: string; parent_id: number | null; is_active: boolean; matches: number; data?: unknown };

const summary = (r: Row): VersionSummary => ({
  id: r.id,
  createdAt: r.created_at.toISOString(),
  note: r.note,
  parentId: r.parent_id,
  active: r.is_active,
  matches: r.matches,
});

/** Newest first. */
export async function listVersions(pool: pg.Pool): Promise<VersionSummary[]> {
  const { rows } = await pool.query<Row>(`${SUMMARY} FROM balance_versions v ORDER BY v.id DESC`);
  return rows.map(summary);
}

export async function getVersion(pool: pg.Pool, id: number): Promise<Version | null> {
  const { rows } = await pool.query<Row>(`${SUMMARY}, v.data FROM balance_versions v WHERE v.id = $1`, [id]);
  return rows[0] ? { ...summary(rows[0]), data: rows[0].data } : null;
}

/**
 * Makes `data` the active version, as a new version whose parent is `basedOn`. Refused if the data wouldn't run, if
 * there's no note, or if another version was applied since `basedOn` (whoever applied it would be overwritten).
 * Running matches keep their version; game servers take the new one up at their next match.
 */
export async function applyVersion(pool: pg.Pool, input: { basedOn: number; note: string; data: unknown }): Promise<ApplyResult> {
  const note = input.note.trim();
  if (!note) return { ok: false, status: 400, issues: ["write a note saying what changed and why"] };
  const checked = checkBalance(input.data);
  if (!checked.ok) return { ok: false, status: 400, issues: checked.issues };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>("SELECT id FROM balance_versions WHERE is_active FOR UPDATE");
    const active = rows[0]?.id ?? null;
    if (active !== input.basedOn) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, issues: [`version ${active} was applied after the one you edited (${input.basedOn}); reload and make your change again`] };
    }
    await client.query("UPDATE balance_versions SET is_active = false WHERE is_active");
    const inserted = await client.query<{ id: number }>(
      "INSERT INTO balance_versions (note, parent_id, data, is_active) VALUES ($1, $2, $3, true) RETURNING id",
      [note, input.basedOn, JSON.stringify(checked.data)],
    );
    await client.query("COMMIT");
    return { ok: true, id: inserted.rows[0]!.id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Rolling back applies a copy of an old version as a new one, so every match keeps pointing at the data it ran on. */
export async function rollBack(pool: pg.Pool, input: { to: number; basedOn: number; note: string }): Promise<ApplyResult> {
  const old = await getVersion(pool, input.to);
  if (!old) return { ok: false, status: 404, issues: [`no version ${input.to}`] };
  return applyVersion(pool, { basedOn: input.basedOn, note: input.note.trim() || `Roll back to version ${input.to}`, data: old.data });
}
