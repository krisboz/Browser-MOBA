import type { Loadout, Side } from "@moba/protocol";
import type pg from "pg";

export interface PlayerRecord {
  side: Side;
  /** Guest session id, or "dummy" for the target dummy. */
  playerRef: string;
  loadout: Loadout;
  result: "win" | "loss";
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  /** Every coin earned in the match, spent or not. */
  gold: number;
  items: { item: string; time: number }[];
  killTimes: number[];
}

export interface MatchRecord {
  balanceVersionId: number;
  mode: string;
  map: string;
  startedAt: Date;
  lengthS: number;
  winnerSide: Side | null;
  players: PlayerRecord[];
}

export type RecordMatch = (record: MatchRecord) => Promise<void>;

/** Writes a finished match and its players in one transaction. */
export function postgresRecorder(pool: pg.Pool): RecordMatch {
  return async (m) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO matches (balance_version_id, mode, map, started_at, length_s, winner_side)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [m.balanceVersionId, m.mode, m.map, m.startedAt, m.lengthS, m.winnerSide],
      );
      const matchId = rows[0]!.id;
      for (const p of m.players) {
        await client.query(
          `INSERT INTO match_players (match_id, side, player_ref, preset, stat_build, spells, summoners, result,
             kills, deaths, assists, damage_dealt, damage_taken, gold, items, kill_times)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            matchId,
            p.side,
            p.playerRef,
            p.loadout.preset,
            JSON.stringify({ range: p.loadout.range, points: p.loadout.points }),
            JSON.stringify(p.loadout.abilities),
            JSON.stringify(p.loadout.summoners),
            p.result,
            p.kills,
            p.deaths,
            p.assists,
            p.damageDealt,
            p.damageTaken,
            Math.round(p.gold),
            JSON.stringify(p.items),
            JSON.stringify(p.killTimes),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };
}
