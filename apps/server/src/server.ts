import type { AddressInfo } from "node:net";
import pg from "pg";
import { WebSocketServer } from "ws";
import { loadActiveBalance } from "./balance-loader.js";
import type { ServerConfig } from "./config.js";
import { Room } from "./room.js";

export interface RunningServer {
  port: number;
  balanceVersion: number;
  close(): Promise<void>;
}

/** Loads the active balance version, then starts listening. Rejects without listening if the balance is missing or invalid. */
export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  let balance;
  try {
    balance = await loadActiveBalance(pool);
  } catch (err) {
    await pool.end();
    throw err;
  }

  // One room for everyone until M6 adds room ids in the URL.
  const room = new Room(balance, config.snapshotRate);
  room.start();

  const wss = new WebSocketServer({ host: config.host, port: config.port });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  wss.on("connection", (ws) => room.join(ws));

  return {
    port: (wss.address() as AddressInfo).port,
    balanceVersion: balance.id,
    async close() {
      room.stop();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await pool.end();
    },
  };
}
