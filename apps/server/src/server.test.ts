import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type ServerMessage } from "@moba/protocol";
import { seedV1 } from "@moba/balance";
import { BalanceLoadError } from "./balance-loader.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { publishSeed, seed } from "./db/seed.js";
import { startServer, type RunningServer } from "./server.js";

// Needs Postgres. CI provides it; locally, start it with `pnpm db:up` and set DATABASE_URL.
const adminUrl = process.env.DATABASE_URL;

describe.skipIf(!adminUrl)("server startup against Postgres", () => {
  const admin = new pg.Pool({ connectionString: adminUrl });
  const created: string[] = [];
  let running: RunningServer | null = null;

  /** A fresh, migrated database just for one test. */
  async function freshDb(): Promise<{ url: string; pool: pg.Pool }> {
    const name = `moba_test_${randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    created.push(name);
    const url = new URL(adminUrl!);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString() });
    await migrate(pool);
    return { url: url.toString(), pool };
  }

  const config = (databaseUrl: string): ServerConfig => ({ ...loadConfig({}), host: "127.0.0.1", port: 0, databaseUrl });

  beforeAll(async () => {
    await admin.query("SELECT 1");
  });

  afterEach(async () => {
    await running?.close();
    running = null;
  });

  afterAll(async () => {
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("loads version 1 and plays a move over the socket", async () => {
    const { url, pool } = await freshDb();
    expect(await seed(pool)).toBe(true);
    expect(await seed(pool)).toBe(false); // idempotent
    await pool.end();

    running = await startServer(config(url));
    expect(running.balanceVersion).toBe(1);

    const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION }));

    const welcome = await until(() => messages.find((m) => m.t === "welcome"));
    expect(welcome).toMatchObject({ balanceVersion: 1, tickRate: 30 });
    expect(welcome.t === "welcome" && welcome.balance).toEqual(seedV1);
    const you = welcome.t === "welcome" ? welcome.you : "";

    ws.send(JSON.stringify({ t: "cmd", cmd: { type: "move", seq: 1, tick: 0, to: { x: 600, y: 120 } } }));
    const moved = await until(() =>
      messages.find((m) => m.t === "snapshot" && m.snap.ackSeq === 1 && m.snap.dots.find((d) => d.id === you)!.x > 200),
    );
    expect(moved.t).toBe("snapshot");
    ws.close();
  });

  it("refuses to start when the active record is invalid", async () => {
    const { url, pool } = await freshDb();
    const broken = { ...seedV1, dot: { ...seedV1.dot, moveSpeed: -1 } };
    await pool.query("INSERT INTO balance_versions (data, is_active) VALUES ($1, true)", [JSON.stringify(broken)]);
    await pool.end();

    await expect(startServer(config(url))).rejects.toThrow(BalanceLoadError);
    await expect(startServer(config(url))).rejects.toThrow(/dot\.moveSpeed/);
  });

  it("refuses to start when the map has no way from base to base", async () => {
    const { url, pool } = await freshDb();
    const walled = { ...seedV1, map: { ...seedV1.map, walls: [{ x: 1500, y: 0, w: 20, h: 600 }] } };
    await pool.query("INSERT INTO balance_versions (data, is_active) VALUES ($1, true)", [JSON.stringify(walled)]);
    await pool.end();
    await expect(startServer(config(url))).rejects.toThrow(/no path from one base to the other/);
  });

  it("answers pings with its tick and applies commands on the tick they were tagged with", async () => {
    const { url, pool } = await freshDb();
    await seed(pool);
    await pool.end();
    running = await startServer(config(url));

    const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION }));
    ws.send(JSON.stringify({ t: "ping", id: 7 }));
    const pong = await until(() => messages.find((m) => m.t === "pong"));
    expect(pong).toMatchObject({ id: 7 });
    const now = pong.t === "pong" ? pong.tick : 0;

    // Tagged 10 ticks ahead: no snapshot before that tick may show it applied.
    const at = now + 10;
    ws.send(JSON.stringify({ t: "cmd", cmd: { type: "move", seq: 1, tick: at, to: { x: 600, y: 120 } } }));
    const applied = await until(() => messages.find((m) => m.t === "snapshot" && m.snap.ackSeq === 1));
    const snaps = messages.filter((m) => m.t === "snapshot").map((m) => (m.t === "snapshot" ? m.snap : null)!);
    for (const s of snaps) {
      if (s.tick <= at) expect(s.ackSeq).toBe(0);
    }
    expect(applied.t === "snapshot" && applied.snap.tick).toBeGreaterThan(at);
    ws.close();
  });

  it("puts a target dummy on the other side, and lets the player attack it", async () => {
    const { url, pool } = await freshDb();
    await seed(pool);
    await pool.end();
    running = await startServer(config(url));

    const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION, preset: "marksman" }));
    const welcome = await until(() => messages.find((m) => m.t === "welcome"));
    expect(welcome).toMatchObject({ side: 0, loadout: { preset: "marksman", range: "ranged" } });

    const withDummy = await until(() => messages.find((m) => m.t === "snapshot" && m.snap.dots.some((d) => d.dummy)));
    const dummy = withDummy.t === "snapshot" ? withDummy.snap.dots.find((d) => d.dummy)! : null;
    expect(dummy).toMatchObject({ side: 1, x: seedV1.dummy.x, y: seedV1.dummy.y, health: 1000 });

    ws.send(JSON.stringify({ t: "cmd", cmd: { type: "attack", seq: 1, tick: 0, target: dummy!.id } }));
    const you = welcome.t === "welcome" ? welcome.you : "";
    const hit = await until(
      () => messages.flatMap((m) => (m.t === "snapshot" ? m.snap.events : [])).find((e) => e.kind === "hit" && e.source === you),
      15_000,
    );
    // Marksman has 8 attack points: 140 damage into a dummy with no armor.
    expect(hit).toMatchObject({ target: dummy!.id, amount: 140 });

    ws.send(JSON.stringify({ t: "dummy", action: "reset" }));
    await until(() => {
      const last = messages.filter((m) => m.t === "snapshot").at(-1);
      return last?.t === "snapshot" && last.snap.dots.find((d) => d.dummy)?.health === 1000 ? true : undefined;
    });
    ws.close();
  });

  it("writes one match record at match end, stamped with the balance version", async () => {
    const { url, pool } = await freshDb();
    // A one-kill match against a dummy that one auto finishes.
    const quick = structuredClone(seedV1);
    quick.match.killsToWin = 1;
    quick.dot.stats.health.base = 50;
    await pool.query("INSERT INTO balance_versions (note, data, is_active) VALUES ('quick', $1, true)", [JSON.stringify(quick)]);
    const { rows: versions } = await pool.query<{ id: number }>("SELECT id FROM balance_versions");
    running = await startServer(config(url));

    const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION, preset: "marksman" }));
    const withDummy = await until(() => messages.find((m) => m.t === "snapshot" && m.snap.dots.some((d) => d.dummy)));
    const dummy = withDummy.t === "snapshot" ? withDummy.snap.dots.find((d) => d.dummy)! : null;
    ws.send(JSON.stringify({ t: "cmd", cmd: { type: "attack", seq: 1, tick: 0, target: dummy!.id } }));
    await until(() => messages.find((m) => m.t === "snapshot" && m.snap.winner === 0), 15_000);

    const matches = await until(async () => {
      const { rows } = await pool.query("SELECT * FROM matches");
      return rows.length ? rows : undefined;
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ balance_version_id: versions[0]!.id, mode: "dummy", map: "lane", winner_side: 0 });
    const { rows: players } = await pool.query("SELECT * FROM match_players ORDER BY side");
    expect(players).toMatchObject([
      { side: 0, preset: "marksman", result: "win", kills: 1, deaths: 0, stat_build: { range: "ranged", points: { attack: 8 } } },
      { side: 1, player_ref: "dummy", result: "loss", deaths: 1 },
    ]);
    expect(players[0].player_ref).toMatch(/^guest-/);
    expect(players[0].spells).toMatchObject({ Q: "piercer", R: "overdrive" });
    expect(players[0].kill_times).toHaveLength(1);
    ws.close();
    await pool.end();
  });

  it("a version applied during a match takes over at the next one; each match's record carries its own", async () => {
    const { url, pool } = await freshDb();
    // One-kill matches against a dummy that one auto finishes.
    const v1 = structuredClone(seedV1);
    v1.match.killsToWin = 1;
    v1.dot.stats.health.base = 50;
    await pool.query("INSERT INTO balance_versions (note, data, is_active) VALUES ('v1', $1, true)", [JSON.stringify(v1)]);
    running = await startServer({ ...config(url), balancePollMs: 100 });

    const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION, preset: "marksman" }));
    await until(() => messages.find((m) => m.t === "welcome"));

    // The owner applies a new version mid-match: Bolt hits harder.
    const v2 = structuredClone(v1);
    const bolt = v2.abilities.find((a) => a.id === "bolt")!.blocks[0]!;
    if (bolt.kind === "projectile") bolt.onHit = [{ kind: "damage", base: 999, ratio: 0.6 }];
    await pool.query("UPDATE balance_versions SET is_active = false");
    const { rows } = await pool.query<{ id: number }>(
      "INSERT INTO balance_versions (note, parent_id, data, is_active) VALUES ('bolt 999', 1, $1, true) RETURNING id",
      [JSON.stringify(v2)],
    );
    const v2id = rows[0]!.id;
    await new Promise((r) => setTimeout(r, 300)); // the server has seen it by now

    let seq = 0;
    const killDummy = async (after: number) => {
      const snap = await until(() => messages.slice(after).find((m) => m.t === "snapshot" && m.snap.dots.some((d) => d.dummy && d.alive)));
      const dummy = snap.t === "snapshot" ? snap.snap.dots.find((d) => d.dummy)! : null;
      ws.send(JSON.stringify({ t: "cmd", cmd: { type: "attack", seq: ++seq, tick: 0, target: dummy!.id } }));
      return until(() => messages.slice(after).find((m) => m.t === "snapshot" && m.snap.winner === 0), 15_000);
    };

    // The match in progress still runs on version 1.
    await killDummy(0);
    const recorded = async (n: number) =>
      until(async () => {
        const r = await pool.query<{ balance_version_id: number }>("SELECT balance_version_id FROM matches ORDER BY id");
        return r.rows.length >= n ? r.rows.map((x) => x.balance_version_id) : undefined;
      });
    expect(await recorded(1)).toEqual([1]);

    // The next match starts on version 2, with a fresh welcome carrying it.
    const at = messages.length;
    const second = await until(() => messages.slice(at).find((m) => m.t === "welcome"), 10_000);
    expect(second).toMatchObject({ balanceVersion: v2id, loadout: { preset: "marksman" } });
    expect(second.t === "welcome" && (second.balance as typeof v2).abilities.find((a) => a.id === "bolt")).toEqual(v2.abilities.find((a) => a.id === "bolt"));
    await killDummy(messages.indexOf(second) + 1);
    expect(await recorded(2)).toEqual([1, v2id]);
    ws.close();
    await pool.end();
  }, 40_000);

  it("publishes changed seed numbers as a new active version, leaving the old one for its matches", async () => {
    const { url, pool } = await freshDb();
    const old = structuredClone(seedV1);
    old.abilities.find((a) => a.id === "bolt")!.windUp = 0.25;
    await pool.query("INSERT INTO balance_versions (note, data, is_active) VALUES ('old', $1, true)", [JSON.stringify(old)]);
    const id = await publishSeed(pool, "faster wind-ups");
    expect(await publishSeed(pool, "again")).toBeNull(); // nothing changed since
    const { rows } = await pool.query("SELECT id, parent_id, note, is_active, data FROM balance_versions ORDER BY id");
    expect(rows).toMatchObject([
      { is_active: false, data: old },
      { id, parent_id: rows[0].id, note: "faster wind-ups", is_active: true, data: seedV1 },
    ]);
    await pool.end();
  });

  it("refuses an unknown preset", async () => {
    const { url, pool } = await freshDb();
    await seed(pool);
    await pool.end();
    running = await startServer(config(url));
    const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION, preset: "wizard" }));
    expect(await until(() => messages.find((m) => m.t === "error"))).toMatchObject({ message: 'unknown preset "wizard"' });
  });

  it("refuses to start when there is no active version", async () => {
    const { url, pool } = await freshDb();
    await pool.end();
    await expect(startServer(config(url))).rejects.toThrow(/no active balance version/);
  });

  it("exits with an error from the command line on an invalid record, without listening", async () => {
    const { url, pool } = await freshDb();
    await pool.query("INSERT INTO balance_versions (data, is_active) VALUES ($1, true)", [JSON.stringify({ nonsense: true })]);
    await pool.end();

    const main = fileURLToPath(new URL("./main.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", main], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, DATABASE_URL: url, HOST: "127.0.0.1", PORT: "0" },
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(1);
    expect(output).toMatch(/refused to start/);
    expect(output).not.toMatch(/listening/);
  });
});

async function until<T>(find: () => T | undefined | Promise<T | undefined>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const found = await find();
    if (found) return found;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}
