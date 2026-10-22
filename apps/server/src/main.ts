import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

try {
  const config = loadConfig();
  const server = await startServer(config);
  console.log(`server listening on ${config.host}:${server.port}, balance version ${server.balanceVersion}`);
  const shutdown = () => void server.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  console.error(`server refused to start: ${(err as Error).message}`);
  process.exit(1);
}
