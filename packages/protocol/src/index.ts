import { z } from "zod";

// Bump on any breaking change to the messages below. Client and server refuse to talk across versions.
export const PROTOCOL_VERSION = 3;

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite }).strict();
const seq = z.number().int().nonnegative();
// The sim tick the client applied the command on; the server applies it on the same tick when it arrives in time.
const tick = z.number().int().nonnegative();
const id = z.string().min(1).max(64);

// ---- Commands: client -> server. The server never trusts these beyond their shape.

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), seq, tick, to: point }).strict(),
  /** Keep auto attacking this dot until another command. */
  z.object({ type: z.literal("attack"), seq, tick, target: id }).strict(),
  /** Stand still: cancels walking, attacking and any wind-up not yet released. */
  z.object({ type: z.literal("stop"), seq, tick }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;

export const clientMessageSchema = z.discriminatedUnion("t", [
  /** `preset` picks the loadout: a preset id, or "vanilla" for a dot with no points (dev). */
  z.object({ t: z.literal("hello"), protocol: z.number().int(), preset: id.optional() }).strict(),
  z.object({ t: z.literal("cmd"), cmd: commandSchema }).strict(),
  z.object({ t: z.literal("ping"), id: z.number().int().nonnegative() }).strict(),
  /** Target dummy controls. */
  z.object({ t: z.literal("dummy"), action: z.enum(["reset", "patrol"]) }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---- Snapshots and setup: server -> client. Trusted, so typed only.

export type Side = 0 | 1;
export type Vec2 = { x: number; y: number };

export interface Loadout {
  preset: string | null;
  range: "melee" | "ranged";
  points: Partial<Record<"health" | "attack" | "attackSpeed" | "magicAttack" | "armor" | "magicResist", number>>;
}

export interface DotSnapshot {
  id: string;
  side: Side;
  x: number;
  y: number;
  /** Radians; where the dot faces (its arms point this way). */
  facing: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Progress of the current auto wind-up, 0..1, or null when not winding up. */
  windUp: number | null;
  /** Tick of the last released auto, for the arms' snap forward. -1 if none. */
  lastReleaseTick: number;
  dummy: boolean;
}

export interface ProjectileSnapshot {
  id: number;
  side: Side;
  x: number;
  y: number;
}

/** Everything the sim needs to rerun your own dot from a snapshot. */
export interface SelfState {
  x: number;
  y: number;
  path: Vec2[];
  facing: number;
  health: number;
  alive: boolean;
  respawnIn: number;
  attackTarget: string | null;
  windUp: { target: string; elapsed: number; duration: number } | null;
  attackReadyIn: number;
  repathIn: number;
  revealedFor: number;
  lastReleaseTick: number;
}

export type GameEvent =
  | { kind: "hit"; tick: number; target: string; source: string; amount: number; x: number; y: number }
  | { kind: "death"; tick: number; target: string; source: string };

export interface Snapshot {
  /** The state after this many ticks. Commands tagged with this tick have not been applied yet. */
  tick: number;
  /** Only what the receiving side can see. */
  dots: DotSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** Highest command seq the server has applied for the receiving player. */
  ackSeq: number;
  self: SelfState | null;
  /** Kills per side. */
  score: [number, number];
  winner: Side | null;
  /** What happened since the previous snapshot, that the receiving side could see. */
  events: GameEvent[];
}

export type ServerMessage =
  | {
      t: "welcome";
      protocol: number;
      you: string;
      side: Side;
      loadout: Loadout;
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
