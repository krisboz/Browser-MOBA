export interface ServerConfig {
  host: string;
  port: number;
  databaseUrl: string;
  snapshotRate: number;
}

export class ConfigError extends Error {}

/** Reads server config from the environment. Defaults suit local development. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
    return n;
  };
  return {
    host: env.HOST || "0.0.0.0",
    port: int("PORT", 8080, 0, 65535),
    databaseUrl: env.DATABASE_URL || "postgres://moba:moba@localhost:5432/moba",
    snapshotRate: int("SNAPSHOT_RATE", 20, 1, 60),
  };
}
