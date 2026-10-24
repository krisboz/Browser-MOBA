import { z } from "zod";

// Bump on any breaking change to the messages below. Client and server refuse to talk across versions.
export const PROTOCOL_VERSION = 6;

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite }).strict();
const seq = z.number().int().nonnegative();
// The sim tick the client applied the command on; the server applies it on the same tick when it arrives in time.
const tick = z.number().int().nonnegative();
const id = z.string().min(1).max(64);

export const SLOTS = ["Q", "W", "E", "R", "D", "F"] as const;
export type CastSlot = (typeof SLOTS)[number];

// ---- Commands: client -> server. The server never trusts these beyond their shape.

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), seq, tick, to: point }).strict(),
  /** Keep auto attacking this dot until another command. */
  z.object({ type: z.literal("attack"), seq, tick, target: id }).strict(),
  /** Attack move: attack the enemy in range closest to `to`; with none in range, walk toward `to` and attack the first
   * that comes into range. */
  z.object({ type: z.literal("attackMove"), seq, tick, to: point }).strict(),
  /** Stand still: cancels walking, attacking, a channel and any wind-up not yet released. */
  z.object({ type: z.literal("stop"), seq, tick }).strict(),
  /** Cast an ability (Q W E R) or summoner (D F) aimed at a point. */
  z.object({ type: z.literal("cast"), seq, tick, slot: z.enum(SLOTS), aim: point }).strict(),
  /** Buy an item: while standing in your own base, or while dead. */
  z.object({ type: z.literal("buy"), seq, tick, item: id }).strict(),
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
  /** Ability ids by slot, null for an empty slot. */
  abilities: { Q: string | null; W: string | null; E: string | null; R: string | null };
  /** Summoner ids on D and F. */
  summoners: [string | null, string | null];
}

/** What a dot is visibly affected by, for drawing. */
export interface DotStatus {
  stunned: boolean;
  rooted: boolean;
  slowed: boolean;
  spellShield: boolean;
  /** Damage the barrier can still absorb. */
  barrier: number;
  buffed: boolean;
  empowered: boolean;
  /** Stacks of a mark on it, and how many detonate it. */
  mark: { stacks: number; of: number } | null;
  /** Only ever seen by its own side. */
  invisible: boolean;
}

/** Dots are players (and the dummy); minions and towers are lane units the same rules apply to. */
export type UnitKind = "dot" | "minion" | "tower";

export interface DotSnapshot {
  id: string;
  kind: UnitKind;
  side: Side;
  radius: number;
  /** Ranged units fire homing shots; melee ones hit at release. */
  ranged: boolean;
  level: number;
  /** Towers only: what it is shooting, so you can see when it is you. Null for everything else. */
  target: string | null;
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
  /** Progress of the current spell wind-up, 0..1, or null. */
  cast: number | null;
  /** Tick of the last spell release. -1 if none. */
  lastCastTick: number;
  status: DotStatus;
  /** A movement in progress that isn't walking. */
  motion: "dash" | "leap" | "knockback" | "pull" | null;
  /** Its hook is out: it can't walk until the hook is back. */
  anchored: boolean;
  channelling: boolean;
  dummy: boolean;
}

export type SpellSnapshot =
  | { kind: "shot"; id: number; side: Side; ability: string; x: number; y: number; width: number }
  | { kind: "hook"; id: number; side: Side; ability: string; x: number; y: number; owner: string; width: number }
  | { kind: "area"; id: number; side: Side; ability: string; x: number; y: number; radius: number; armed: boolean; progress: number }
  | { kind: "zone"; id: number; side: Side; ability: string; x: number; y: number; radius: number }
  | { kind: "trap"; id: number; side: Side; ability: string; x: number; y: number; radius: number };

export interface ProjectileSnapshot {
  id: number;
  side: Side;
  x: number;
  y: number;
}

/** Your own dot: the parts the HUD reads, plus its full sim state for prediction to rerun from. */
export interface SelfState {
  x: number;
  y: number;
  alive: boolean;
  respawnIn: number;
  /** Seconds left on each slot's cooldown. */
  cooldowns: Record<CastSlot, number>;
  gold: number;
  level: number;
  /** Experience into the current level. */
  xp: number;
  /** Item ids, in the order bought. */
  items: string[];
  /** The sim's whole dot, opaque here; only packages/sim reads it. */
  dot: unknown;
}

export type GameEvent =
  /** `ability` is set when the damage came from an ability rather than a plain auto. */
  | { kind: "hit"; tick: number; target: string; source: string; amount: number; x: number; y: number; ability: string | null }
  | { kind: "death"; tick: number; target: string; source: string }
  /** A spell shield or a dome stopped a spell. */
  | { kind: "blocked"; tick: number; target: string; source: string; x: number; y: number }
  | { kind: "heal"; tick: number; target: string; amount: number; x: number; y: number }
  /** Gold paid to `target` for a last hit, kill or tower. Only its owner hears of it. */
  | { kind: "gold"; tick: number; target: string; amount: number; x: number; y: number }
  | { kind: "level"; tick: number; target: string; level: number; x: number; y: number };

export interface Snapshot {
  /** The state after this many ticks. Commands tagged with this tick have not been applied yet. */
  tick: number;
  /** Only what the receiving side can see. */
  dots: DotSnapshot[];
  projectiles: ProjectileSnapshot[];
  spells: SpellSnapshot[];
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
