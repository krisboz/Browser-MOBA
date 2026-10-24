import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { migrate } from "../../server/src/db/migrate.js";
import { handler } from "./api.js";
import { ConfigError, loadDashboardConfig } from "./config.js";
import { setAt } from "./fields.js";

describe("dashboard config", () => {
  it("listens on this machine only, unless a token guards it", () => {
    expect(loadDashboardConfig({})).toMatchObject({ host: "127.0.0.1", port: 8081, token: null });
    expect(() => loadDashboardConfig({ DASHBOARD_HOST: "0.0.0.0" })).toThrow(ConfigError);
    expect(loadDashboardConfig({ DASHBOARD_HOST: "0.0.0.0", DASHBOARD_TOKEN: "s3cret" })).toMatchObject({ host: "0.0.0.0", token: "s3cret" });
  });
});

// Needs Postgres, like the server tests: each test makes and drops its own database.
const adminUrl = process.env.DATABASE_URL;

describe.skipIf(!adminUrl)("dashboard API against Postgres", () => {
  const admin = new pg.Pool({ connectionString: adminUrl });
  const created: string[] = [];
  const open: { server: Server; pool: pg.Pool }[] = [];

  async function start(token: string | null = null) {
    const name = `moba_test_${randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    created.push(name);
    const url = new URL(adminUrl!);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString() });
    await migrate(pool);
    await pool.query("INSERT INTO balance_versions (note, data, is_active) VALUES ('v0 numbers', $1, true)", [JSON.stringify(seedV1)]);
    const server = createServer(handler({ pool, token, staticDir: null }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    open.push({ server, pool });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
    const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? null : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as any };
    };
    return { pool, call };
  }

  afterAll(async () => {
    for (const { server, pool } of open) {
      server.close();
      await pool.end();
    }
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  const boltPath = ["abilities", 0, "blocks", 0, "onHit", 0, "base"];

  it("applies an edit as a new active version with a note and a parent, leaving the old one as it was", async () => {
    const { pool, call } = await start();
    const edited = setAt(seedV1, boltPath, 150);
    const applied = await call("versions", { basedOn: 1, note: "Bolt 120 -> 150", data: edited });
    expect(applied).toMatchObject({ status: 201, json: { ok: true, id: 2 } });

    const list = await call("versions");
    expect(list.json).toMatchObject([
      { id: 2, note: "Bolt 120 -> 150", parentId: 1, active: true, matches: 0 },
      { id: 1, active: false },
    ]);
    expect((await call("versions/2")).json.data.abilities[0].blocks[0].onHit[0].base).toBe(150);
    expect((await call("versions/1")).json.data).toEqual(seedV1);

    // A match on version 1 still counts there.
    await pool.query("INSERT INTO matches (balance_version_id, mode, map, started_at, length_s) VALUES (1, 'dummy', 'lane', now(), 60)");
    expect((await call("versions")).json[1]).toMatchObject({ id: 1, matches: 1 });
  });

  it("refuses data the game server would refuse, an empty note, and an edit of a version that is no longer active", async () => {
    const { call } = await start();
    const bad = await call("versions", { basedOn: 1, note: "oops", data: setAt(seedV1, ["dot", "moveSpeed"], -1) });
    expect(bad).toMatchObject({ status: 400, json: { ok: false, issues: [expect.stringMatching(/dot\.moveSpeed/)] } });
    expect((await call("versions", { basedOn: 1, note: "  ", data: seedV1 })).status).toBe(400);

    // Two tabs edit version 1; the second apply would silently undo the first.
    expect((await call("versions", { basedOn: 1, note: "first", data: setAt(seedV1, boltPath, 130) })).status).toBe(201);
    const stale = await call("versions", { basedOn: 1, note: "second", data: setAt(seedV1, boltPath, 140) });
    expect(stale).toMatchObject({ status: 409, json: { issues: [expect.stringMatching(/version 2 was applied/)] } });
    expect((await call("versions")).json).toHaveLength(2);
  });

  it("rolls back by applying a copy of the old version as a new one", async () => {
    const { call } = await start();
    await call("versions", { basedOn: 1, note: "Bolt 150", data: setAt(seedV1, boltPath, 150) });
    const back = await call("versions/1/rollback", { basedOn: 2, note: "" });
    expect(back).toMatchObject({ status: 201, json: { ok: true, id: 3 } });
    const v3 = (await call("versions/3")).json;
    expect(v3).toMatchObject({ active: true, parentId: 2, note: "Roll back to version 1" });
    expect(v3.data).toEqual(seedV1);
    expect((await call("versions/9/rollback", { basedOn: 3, note: "" })).status).toBe(404);
  });

  it("asks for the token when one is set", async () => {
    const { call } = await start("s3cret");
    expect((await call("versions")).status).toBe(401);
    expect((await call("versions", undefined, { "x-dashboard-token": "s3cret" })).status).toBe(200);
  });
});
