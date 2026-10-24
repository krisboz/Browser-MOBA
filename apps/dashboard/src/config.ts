export interface DashboardConfig {
  host: string;
  port: number;
  databaseUrl: string;
  token: string | null;
}

export class ConfigError extends Error {}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Reads dashboard config from the environment. It edits live balance, so it listens on this machine only unless
 * a token guards it.
 */
export function loadDashboardConfig(env: NodeJS.ProcessEnv = process.env): DashboardConfig {
  const host = env.DASHBOARD_HOST || "127.0.0.1";
  const rawPort = env.DASHBOARD_PORT || "8081";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`DASHBOARD_PORT must be a port number, got "${rawPort}"`);
  const token = env.DASHBOARD_TOKEN || null;
  if (!LOOPBACK.has(host) && !token) throw new ConfigError(`set DASHBOARD_TOKEN before listening on ${host}: anyone who reaches it can change the game`);
  return { host, port, databaseUrl: env.DATABASE_URL || "postgres://moba:moba@localhost:5432/moba", token };
}
