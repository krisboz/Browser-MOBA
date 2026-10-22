import { z } from "zod";

// Bump on any breaking change to the messages below. Client and server refuse to talk across versions.
export const PROTOCOL_VERSION = 1;

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite }).strict();

// ---- Commands: client -> server. The server never trusts these beyond their shape.

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), seq: z.number().int().nonnegative(), to: point }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), protocol: z.number().int() }).strict(),
  z.object({ t: z.literal("cmd"), cmd: commandSchema }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---- Snapshots and setup: server -> client. Trusted, so typed only.

export type Side = 0 | 1;

export interface DotSnapshot {
  id: string;
  side: Side;
  x: number;
  y: number;
}

export interface Snapshot {
  tick: number;
  dots: DotSnapshot[];
  // Last command seq the server applied for the receiving player (used by prediction in M1).
  ackSeq: number;
}

export type ServerMessage =
  | {
      t: "welcome";
      protocol: number;
      you: string;
      tickRate: number;
      balanceVersion: number;
      // The pinned balance record for this room, so both sides run the same definitions.
      balance: unknown;
    }
  | { t: "snapshot"; snap: Snapshot }
  | { t: "error"; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}
