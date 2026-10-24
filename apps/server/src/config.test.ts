import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads the address, port and database from the environment", () => {
    const config = loadConfig({ HOST: "127.0.0.1", PORT: "9001", DATABASE_URL: "postgres://x@db/y", SNAPSHOT_RATE: "10" });
    expect(config).toEqual({ host: "127.0.0.1", port: 9001, databaseUrl: "postgres://x@db/y", snapshotRate: 10, balancePollMs: 5000 });
  });

  it("falls back to local defaults", () => {
    expect(loadConfig({}).port).toBe(8080);
  });

  it("rejects a bad port", () => {
    expect(() => loadConfig({ PORT: "eighty" })).toThrow(ConfigError);
  });
});
