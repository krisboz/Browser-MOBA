import type { BalanceData } from "@moba/balance";
import type { CastSlot, Command, DotSnapshot, GameEvent, Loadout, SelfState, Side, Snapshot, SpellSnapshot } from "@moba/protocol";
import { attackOrWalk, clearAttack, heal, stepProjectiles } from "./combat.js";
import { buildGeometry, type MapGeometry, type Vec } from "./geometry.js";
import { stepMotion } from "./motion.js";
import { findPath, NavGrid } from "./nav.js";
import { castSlot, stepCast, stepChannel, stepSpells, zoneRadius } from "./spells.js";
import { computeStats } from "./stats.js";
import { interrupt, isInvisible, isRooted, isStunned, tickStatuses } from "./statuses.js";
import { DT } from "./tick.js";
import type { Dot, World } from "./types.js";
import { isVisibleTo } from "./vision.js";

export type { Vec } from "./geometry.js";
export type { Dot, Projectile, SpellEntity, Status, World, WindUp } from "./types.js";
export { damageDot, inRange } from "./combat.js";
export { canCast } from "./spells.js";
export { effectiveStats } from "./statuses.js";

const SLOT_KEYS: CastSlot[] = ["Q", "W", "E", "R", "D", "F"];
const noCooldowns = (): Record<CastSlot, number> => ({ Q: 0, W: 0, E: 0, R: 0, D: 0, F: 0 });

// Building the nav grid takes a few ms, so each balance record builds it once and every world shares it.
const mapCache = new WeakMap<BalanceData, { geometry: MapGeometry; nav: NavGrid; defs: World["defs"] }>();

function mapFor(balance: BalanceData) {
  let cached = mapCache.get(balance);
  if (!cached) {
    const geometry = buildGeometry(balance);
    cached = {
      geometry,
      nav: new NavGrid(geometry, balance.dot.radius),
      defs: new Map([...balance.abilities, ...balance.summoners].map((d) => [d.id, d])),
    };
    mapCache.set(balance, cached);
  }
  return cached;
}

export function createWorld(balance: BalanceData): World {
  return {
    balance,
    ...mapFor(balance),
    tick: 0,
    dots: new Map(),
    projectiles: [],
    spells: [],
    nextId: 1,
    score: [0, 0],
    winner: null,
    events: [],
  };
}

export interface NewDot {
  id: string;
  side: Side;
  loadout: Loadout;
  pos?: Vec;
  dummy?: boolean;
}

export function addDot(world: World, opts: NewDot): Dot {
  const stats = computeStats(world.balance, opts.loadout);
  const home = opts.pos ?? world.geometry.spawns[opts.side];
  const dot: Dot = {
    id: opts.id,
    side: opts.side,
    loadout: opts.loadout,
    stats,
    home: { ...home },
    dummy: opts.dummy ?? false,
    pos: { ...home },
    path: [],
    facing: opts.side === 0 ? 0 : Math.PI,
    health: stats.maxHealth,
    alive: true,
    respawnIn: 0,
    attackTarget: null,
    windUp: null,
    attackReadyIn: 0,
    repathIn: 0,
    revealedFor: 0,
    lastReleaseTick: -1,
    patrol: null,
    cooldowns: noCooldowns(),
    statuses: [],
    motion: null,
    cast: null,
    lastCastTick: -1,
    channel: null,
    anchoredBy: null,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    damageTaken: 0,
  };
  world.dots.set(dot.id, dot);
  return dot;
}

export function removeDot(world: World, id: string): void {
  world.dots.delete(id);
  for (const d of world.dots.values()) if (d.attackTarget === id) clearAttack(d);
}

export function applyCommand(world: World, dotId: string, cmd: Command): void {
  const dot = world.dots.get(dotId);
  if (!dot || !dot.alive || world.winner !== null) return;
  switch (cmd.type) {
    case "move":
      // A new order cancels a spell still winding up (nothing fires, no cooldown). Rooted or anchored,
      // the order is kept and the walk starts once free.
      dot.cast = null;
      clearAttack(dot);
      dot.path = findPath(world.nav, dot.pos, cmd.to);
      break;
    case "stop":
      clearAttack(dot);
      interrupt(dot);
      dot.path = [];
      break;
    case "attack": {
      const target = world.dots.get(cmd.target);
      if (!target || target.side === dot.side || !target.alive || !isVisibleTo(world, target, dot.side)) return;
      dot.cast = null;
      if (dot.attackTarget !== target.id) clearAttack(dot);
      dot.attackTarget = target.id;
      dot.path = [];
      dot.repathIn = 0;
      break;
    }
    case "cast":
      castSlot(world, dot, cmd.slot, cmd.aim);
      break;
  }
}

/**
 * Advances the world by exactly one fixed tick. Per living dot: timers, then acting (a stun stops it, a spell
 * wind-up or channel takes the tick, otherwise attacking or walking), then any forced movement. Then spells,
 * autos in flight, and healing.
 */
export function step(world: World): void {
  if (world.winner !== null) {
    world.tick++;
    return;
  }
  for (const dot of world.dots.values()) {
    if (!dot.alive) {
      dot.respawnIn -= DT;
      if (dot.respawnIn <= 0) respawn(dot);
      continue;
    }
    dot.attackReadyIn = Math.max(0, dot.attackReadyIn - DT);
    dot.revealedFor = Math.max(0, dot.revealedFor - DT);
    dot.repathIn -= DT;
    for (const slot of SLOT_KEYS) dot.cooldowns[slot] = Math.max(0, dot.cooldowns[slot] - DT);
    tickStatuses(dot, DT);

    if (isStunned(dot)) interrupt(dot);
    else if (!stepCast(world, dot) && !stepChannel(dot)) {
      patrol(world, dot);
      attackOrWalk(world, dot);
    }
    stepMotion(world, dot);
  }
  stepSpells(world);
  stepProjectiles(world);
  for (const dot of world.dots.values()) if (dot.alive) heal(world, dot);
  world.tick++;
}

function respawn(dot: Dot): void {
  dot.alive = true;
  dot.respawnIn = 0;
  dot.health = dot.stats.maxHealth;
  dot.pos = { ...dot.home };
  dot.path = [];
  dot.statuses = [];
  dot.motion = null;
  dot.facing = dot.side === 0 ? 0 : Math.PI;
}

function patrol(world: World, dot: Dot): void {
  const p = dot.patrol;
  if (!p || dot.attackTarget || dot.path.length || dot.motion) return;
  p.towardB = !p.towardB;
  dot.path = findPath(world.nav, dot.pos, p.towardB ? p.b : p.a);
}

/**
 * Takes everything that happened since the last call: during steps, and during commands (a spell with no
 * wind-up goes off as the command arrives). Whoever reports events drains them; nothing else clears them.
 */
export function drainEvents(world: World): GameEvent[] {
  const out = world.events;
  world.events = [];
  return out;
}

/** Starts a fresh match in the same world: score cleared, every dot back home at full health, spells gone. */
export function resetMatch(world: World): void {
  world.score = [0, 0];
  world.winner = null;
  world.projectiles = [];
  world.spells = [];
  for (const dot of world.dots.values()) {
    respawn(dot);
    clearAttack(dot);
    interrupt(dot);
    dot.attackReadyIn = 0;
    dot.cooldowns = noCooldowns();
    dot.anchoredBy = null;
    dot.kills = dot.deaths = 0;
    dot.damageDealt = dot.damageTaken = 0;
  }
}

/** Target dummy: back to full health, and rid of whatever it is suffering. */
export function resetHealth(dot: Dot): void {
  if (!dot.alive) return;
  dot.health = dot.stats.maxHealth;
  dot.statuses = [];
}

/** Target dummy: walk back and forth across the lane around its spot, or stop. */
export function setPatrol(world: World, dot: Dot, on: boolean): void {
  if (!on) {
    dot.patrol = null;
    dot.path = [];
    return;
  }
  const span = world.balance.dummy.patrolHalfSpan;
  dot.patrol = {
    a: world.nav.nearestStandable({ x: dot.home.x, y: dot.home.y - span }),
    b: world.nav.nearestStandable({ x: dot.home.x, y: dot.home.y + span }),
    towardB: false,
  };
}

export function dotSnapshot(world: World, d: Dot): DotSnapshot {
  const mark = d.statuses.find((s) => s.kind === "mark");
  const has = (kind: Dot["statuses"][number]["kind"]) => d.statuses.some((s) => s.kind === kind);
  return {
    id: d.id,
    side: d.side,
    x: d.pos.x,
    y: d.pos.y,
    facing: d.facing,
    health: d.health,
    maxHealth: d.stats.maxHealth,
    alive: d.alive,
    windUp: d.windUp ? Math.min(1, d.windUp.elapsed / d.windUp.duration) : null,
    lastReleaseTick: d.lastReleaseTick,
    cast: d.cast ? Math.min(1, d.cast.elapsed / d.cast.duration) : null,
    lastCastTick: d.lastCastTick,
    status: {
      stunned: isStunned(d),
      rooted: isRooted(d),
      slowed: has("slow"),
      spellShield: has("spellShield"),
      barrier: d.statuses.reduce((sum, s) => sum + (s.kind === "barrier" ? s.amount : 0), 0),
      buffed: has("buff"),
      empowered: has("empowered"),
      mark: mark?.kind === "mark" ? { stacks: mark.stacks, of: mark.of } : null,
      invisible: isInvisible(d),
    },
    motion: d.motion?.kind ?? null,
    anchored: d.anchoredBy !== null,
    channelling: d.channel !== null,
    dummy: d.dummy,
  };
}

function spellSnapshot(s: World["spells"][number]): SpellSnapshot {
  const base = { id: s.id, side: s.ctx.side, ability: s.ctx.ability, x: s.pos.x, y: s.pos.y };
  switch (s.kind) {
    case "shot":
      return { kind: "shot", ...base, width: s.width };
    case "hook":
      return { kind: "hook", ...base, owner: s.ctx.caster, width: s.width };
    case "area":
      return { kind: "area", ...base, radius: s.radius, armed: s.armed, progress: s.armed || s.delay <= 0 ? 1 : 1 - s.delayLeft / s.delay };
    case "zone":
      return { kind: "zone", ...base, radius: zoneRadius(s) };
    case "trap":
      return { kind: "trap", ...base, radius: s.radius };
  }
}

export function selfState(d: Dot): SelfState {
  return { x: d.pos.x, y: d.pos.y, alive: d.alive, respawnIn: d.respawnIn, cooldowns: { ...d.cooldowns }, dot: structuredClone(d) };
}

/** Puts a dot back into the state the server reported, for prediction to rerun from. */
export function applySelfState(d: Dot, s: SelfState): void {
  Object.assign(d, structuredClone(s.dot as Dot));
}

/** What one player may see: everything visible to their side, plus their own dot's full state. */
export function snapshot(world: World, viewer: { side: Side; dotId: string | null }, ackSeq: number, events: GameEvent[] = []): Snapshot {
  const dots: DotSnapshot[] = [];
  for (const d of world.dots.values()) if (isVisibleTo(world, d, viewer.side)) dots.push(dotSnapshot(world, d));
  const own = viewer.dotId ? world.dots.get(viewer.dotId) : undefined;
  const visible = new Set(dots.map((d) => d.id));
  return {
    tick: world.tick,
    ackSeq,
    dots,
    projectiles: world.projectiles
      .filter((p) => p.side === viewer.side || visible.has(p.owner) || visible.has(p.target))
      .map((p) => ({ id: p.id, side: p.side, x: p.pos.x, y: p.pos.y })),
    // Traps stay hidden from the other side.
    spells: world.spells.filter((s) => s.kind !== "trap" || s.ctx.side === viewer.side).map(spellSnapshot),
    self: own ? selfState(own) : null,
    score: [...world.score],
    winner: world.winner,
    events,
  };
}
