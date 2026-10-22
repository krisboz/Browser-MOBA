import pg from "pg";
import { loadConfig } from "../config.js";
import { migrate } from "./migrate.js";
import { seed } from "./seed.js";

const command = process.argv[2];
const pool = new pg.Pool({ connectionString: loadConfig().databaseUrl });
try {
  if (command === "migrate") {
    const applied = await migrate(pool);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
  } else if (command === "seed") {
    const replace = process.argv.includes("--force");
    console.log((await seed(pool, { replace })) ? "seeded balance version 1" : "balance versions already exist, nothing seeded (--force replaces them)");
  } else {
    console.error("usage: cli.ts migrate | seed [--force]");
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
