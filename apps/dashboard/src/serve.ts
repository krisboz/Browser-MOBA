import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { handler } from "./api.js";
import { loadDashboardConfig } from "./config.js";

try {
  const config = loadDashboardConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  await pool.query("SELECT 1 FROM balance_versions LIMIT 1");
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const server = createServer(handler({ pool, token: config.token, staticDir: existsSync(dist) ? dist : null }));
  server.listen(config.port, config.host, () => console.log(`dashboard API on http://${config.host}:${config.port}`));
  const shutdown = () => server.close(() => void pool.end().then(() => process.exit(0)));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  console.error(`dashboard refused to start: ${(err as Error).message}`);
  process.exit(1);
}
