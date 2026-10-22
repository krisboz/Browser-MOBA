import { z } from "zod";

// Bump on any breaking change to the messages below. Client and server refuse to talk across versions.
export const PROTOCOL_VERSION = 2;

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite }).strict();

// ---- Commands: client -> server. The server never trusts these beyond their shape.

export const commandSchema = z.discriminatedUnion("type", [
  // `tick` is the sim tick the client applied the command on; the server applies it on the same tick when it arrives in time.
  z.object({ type: z.literal("move"), seq: z.number().int().nonnegative(), tick: z.number().int().nonnegative(), to: point }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), protocol: z.number().int() }).strict(),
  z.object({ t: z.literal("cmd"), cmd: commandSchema }).strict(),
  z.object({ t: z.literal("ping"), id: z.number().int().nonnegative() }).strict(),
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

/** The receiving player's own dot in full, so the client can rerun its prediction from it. */
export interface SelfState {
  x: number;
  y: number;
  path: { x: number; y: number }[];
}

export interface Snapshot {
  /** The state after this many ticks. Commands tagged with this tick have not been applied yet. */
  tick: number;
  /** Only what the receiving side can see. */
  dots: DotSnapshot[];
  /** Highest command seq the server has applied for the receiving player. */
  ackSeq: number;
  self: SelfState | null;
}

export type ServerMessage =
  | {
      t: "welcome";
      protocol: number;
      you: string;
      side: Side;
      tick: number;
      tickRate: number;
      balanceVersion: number;
      // The pinned balance record for this room, so both sides run the same definitions.
      balance: unknown;
    }
  | { t: "snapshot"; snap: Snapshot }
  | { t: "pong"; id: number; tick: number }
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
