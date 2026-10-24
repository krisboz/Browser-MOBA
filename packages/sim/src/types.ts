import type { AbilityDef, AreaBlockDef, BalanceData, DamageEffectDef, EffectDef, SummonerDef } from "@moba/balance";
import type { CastSlot, GameEvent, Loadout, Side, UnitKind } from "@moba/protocol";
import type { MapGeometry, Vec } from "./geometry.js";
import type { NavGrid } from "./nav.js";
import type { Stats } from "./stats.js";

// Everything here is plain data (no Maps, Sets or classes inside a Dot), so a dot can be sent
// to its owner as-is and rerun by client prediction.

export interface WindUp {
  target: string;
  elapsed: number;
  duration: number;
}

export type StatBonus = { [K in "health" | "attack" | "attackSpeed" | "magicAttack" | "armor" | "magicResist" | "moveSpeedPct"]?: number | undefined };

/** One cast going off: who cast what, with how much power, and which domes the caster stood in. */
export interface SpellCtx {
  caster: string;
  side: Side;
  ability: string;
  type: "physical" | "magic" | "none";
  /** The caster's attack and magic attack when it went off, so damage doesn't change if the caster dies. */
  attack: number;
  magicAttack: number;
  /** Domes the caster stood in when casting. Those domes never block this cast. */
  castInside: number[];
  /** False for the extra hit riding on an empowered auto: it's part of an auto, so domes and spell shields ignore it. */
  spell: boolean;
  /** Dots a spell shield already blocked this cast on; it keeps missing them. */
  blockedOn: string[];
}

export type Status =
  | { kind: "stun"; remaining: number }
  | { kind: "root"; remaining: number }
  | { kind: "slow"; remaining: number; amount: number }
  | { kind: "buff"; remaining: number; duration: number; fades: boolean; stats: StatBonus; ability: string }
  | { kind: "spellShield"; remaining: number }
  | { kind: "barrier"; remaining: number; amount: number }
  | { kind: "invisible"; remaining: number }
  /** The next auto carries `onHit`. */
  | { kind: "empowered"; remaining: number; ctx: SpellCtx; onHit: EffectDef[] }
  /** Autos from `source` add stacks; reaching `of` detonates it. */
  | { kind: "mark"; remaining: number; source: string; stacks: number; of: number; ctx: SpellCtx; onDetonate: DamageEffectDef[] };

/** Any movement that isn't walking. A dot has one at a time: the newest replaces whatever was in progress. */
export type Motion =
  | { kind: "dash" | "leap"; to: Vec; speed: number; onLand: AreaBlockDef[]; ctx: SpellCtx | null }
  | { kind: "knockback"; to: Vec; speed: number }
  /** Dragged toward wherever `toward` is now. */
  | { kind: "pull"; toward: string; speed: number; hook: number };

export interface Cast {
  slot: CastSlot;
  aim: Vec;
  elapsed: number;
  duration: number;
}

export interface Channel {
  slot: CastSlot;
  ability: string;
  type: "physical" | "magic" | "none";
  remaining: number;
  shotsLeft: number;
  shotReadyIn: number;
  shotInterval: number;
  shot: AreaBlockDef;
}

/**
 * Anything on the map that fights: a player's dot (or the dummy), a minion or a tower. They share one shape so every
 * rule (autos, spells, statuses, forced movement, vision) applies to all of them; `kind` only decides who controls
 * them and what their death pays.
 */
export interface Dot {
  id: string;
  kind: UnitKind;
  side: Side;
  radius: number;
  /** Minions and towers have one too: no points, no spells, and their range. */
  loadout: Loadout;
  /** Base stats from points and items (or the unit's balance line). Buffs and slows apply on top: see effectiveStats. */
  stats: Stats;
  /** Where it respawns. */
  home: Vec;
  /** True for the target dummy: a dot no player controls. Rules treat it like any other dot. */
  dummy: boolean;
  pos: Vec;
  /** Remaining waypoints of the current walk; empty when standing still. */
  path: Vec[];
  facing: number;
  health: number;
  alive: boolean;
  respawnIn: number;
  /** The dot this one keeps auto attacking, until another command. */
  attackTarget: string | null;
  windUp: WindUp | null;
  /** Seconds until the next wind-up may start. */
  attackReadyIn: number;
  repathIn: number;
  /** Seconds left visible from brush after attacking or casting. */
  revealedFor: number;
  lastReleaseTick: number;
  /** Target dummy only: walking back and forth across the lane. */
  patrol: { a: Vec; b: Vec; towardB: boolean } | null;
  cooldowns: Record<CastSlot, number>;
  statuses: Status[];
  motion: Motion | null;
  /** A spell winding up; nothing fires until it is released. */
  cast: Cast | null;
  lastCastTick: number;
  channel: Channel | null;
  /** Id of this dot's hook while it is out. The thrower can't walk until it is back. */
  anchoredBy: number | null;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  /** Economy, used by dots only. Gold is fractional because of the per-second trickle. */
  gold: number;
  /** Every coin paid this match, spent or not. */
  goldEarned: number;
  /** Experience earned this match; the level follows from it. */
  xp: number;
  level: number;
  /** Items bought, with the match time in seconds. */
  items: { id: string; at: number }[];
  /** Match time in seconds of each kill. */
  killTimes: number[];
  /** Minions only: where it marches, and the dot it is chasing for attacking one of its side's dots. */
  minion: { goal: Vec; aggroOn: string | null; aggroFor: number } | null;
  /** Towers only: consecutive shots at the same target, for the ramp. */
  tower: { rampOn: string | null; hits: number } | null;
}

/** A ranged auto in flight. Homes on its target with no physics and always lands, unless the target dies first. */
export interface Projectile {
  id: number;
  owner: string;
  side: Side;
  target: string;
  pos: Vec;
  speed: number;
  damage: number;
  /** An empowered auto's extra effects, applied when it lands. */
  bonus: { ctx: SpellCtx; onHit: EffectDef[] } | null;
}

export type SpellEntity =
  | {
      kind: "shot";
      id: number;
      ctx: SpellCtx;
      pos: Vec;
      dir: Vec;
      speed: number;
      range: number;
      traveled: number;
      width: number;
      hits: "first" | "pierce";
      falloff: number;
      returns: boolean;
      returning: boolean;
      /** Dots hit on this pass. */
      hitIds: string[];
      hitCount: number;
      onHit: EffectDef[];
    }
  | {
      kind: "hook";
      id: number;
      ctx: SpellCtx;
      pos: Vec;
      dir: Vec;
      speed: number;
      range: number;
      traveled: number;
      width: number;
      retractSpeed: number;
      state: "out" | "pulling" | "returning";
      victim: string | null;
      onHit: EffectDef[];
    }
  | {
      kind: "area";
      id: number;
      ctx: SpellCtx;
      pos: Vec;
      radius: number;
      timing: "instant" | "delayed" | "lasting";
      delay: number;
      delayLeft: number;
      /** Lasting: seconds left once armed. Instant and delayed: how long it stays drawn after going off. */
      remaining: number;
      armed: boolean;
      onHit: EffectDef[];
      whileInside: EffectDef[];
      hitIds: string[];
    }
  | {
      kind: "zone";
      id: number;
      ctx: SpellCtx;
      pos: Vec;
      radius: number;
      expandTime: number;
      age: number;
      duration: number;
      pushes: boolean;
      blocks: boolean;
    }
  | { kind: "trap"; id: number; ctx: SpellCtx; pos: Vec; radius: number; remaining: number; onEnter: EffectDef[] };

export interface World {
  balance: BalanceData;
  geometry: MapGeometry;
  nav: NavGrid;
  /** Every ability and summoner by id. */
  defs: Map<string, AbilityDef | SummonerDef>;
  tick: number;
  dots: Map<string, Dot>;
  projectiles: Projectile[];
  spells: SpellEntity[];
  nextId: number;
  score: [number, number];
  winner: Side | null;
  /** Whether this world runs the lane: towers, minion waves, minion and tower targeting, the gold trickle. Only the
   * server's does; tests and the client's prediction leave it off. */
  lane: boolean;
  /** Tick the current match started on. */
  matchStartTick: number;
  /** Seconds until the next minion wave. */
  nextWaveIn: number;
  /** What happened since the last drainEvents. */
  events: GameEvent[];
}
