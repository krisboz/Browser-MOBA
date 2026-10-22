import type { BalanceData } from "@moba/balance";
import type { Command, DotSnapshot, GameEvent, Loadout, SelfState, Side, Snapshot } from "@moba/protocol";
import { buildGeometry, dist, isClear, isSegmentClear, pushOut, type MapGeometry, type Vec } from "./geometry.js";
import { findPath, NavGrid } from "./nav.js";
import { attackInterval, computeStats, mitigate, type Stats } from "./stats.js";
import { DT } from "./tick.js";
import { isVisibleTo } from "./vision.js";

export type { Vec } from "./geometry.js";

// How often a dot chasing an attack target re-plans its path, in seconds.
const CHASE_REPATH = 0.25;

export interface WindUp {
  target: string;
  elapsed: number;
  duration: number;
}

export interface Dot {
  id: string;
  side: Side;
  loadout: Loadout;
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
  /** Seconds left visible from brush after attacking. */
  revealedFor: number;
  lastReleaseTick: number;
  /** Target dummy only: walking back and forth across the lane. */
  patrol: { a: Vec; b: Vec; towardB: boolean } | null;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
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
}

export interface World {
  balance: BalanceData;
  geometry: MapGeometry;
  nav: NavGrid;
  tick: number;
  dots: Map<string, Dot>;
  projectiles: Projectile[];
  nextProjectileId: number;
  score: [number, number];
  winner: Side | null;
  /** What happened during the last step. Cleared at the start of each step. */
  events: GameEvent[];
}

// Building the nav grid takes a few ms, so each balance record builds it once and every world shares it.
const mapCache = new WeakMap<BalanceData, { geometry: MapGeometry; nav: NavGrid }>();

function mapFor(balance: BalanceData) {
  let cached = mapCache.get(balance);
  if (!cached) {
    const geometry = buildGeometry(balance);
    cached = { geometry, nav: new NavGrid(geometry, balance.dot.radius) };
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
    nextProjectileId: 1,
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

/** Drops the attack order and any wind-up not yet released. Nothing fires; the attack timer is refunded. */
function clearAttack(dot: Dot): void {
  dot.attackTarget = null;
  if (dot.windUp) {
    dot.windUp = null;
    dot.attackReadyIn = 0;
  }
}

export function applyCommand(world: World, dotId: string, cmd: Command): void {
  const dot = world.dots.get(dotId);
  if (!dot || !dot.alive || world.winner !== null) return;
  switch (cmd.type) {
    case "move":
      clearAttack(dot);
      dot.path = findPath(world.nav, dot.pos, cmd.to);
      break;
    case "stop":
      clearAttack(dot);
      dot.path = [];
      break;
    case "attack": {
      const target = world.dots.get(cmd.target);
      if (!target || target.side === dot.side || !target.alive || !isVisibleTo(world, target, dot.side)) return;
      if (dot.attackTarget !== target.id) clearAttack(dot);
      dot.attackTarget = target.id;
      dot.path = [];
      dot.repathIn = 0;
      break;
    }
  }
}

/** Advances the world by exactly one fixed tick. */
export function step(world: World): void {
  world.events = [];
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
    patrol(world, dot);
    act(world, dot);
  }
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
  dot.facing = dot.side === 0 ? 0 : Math.PI;
}

function patrol(world: World, dot: Dot): void {
  const p = dot.patrol;
  if (!p || dot.attackTarget || dot.path.length) return;
  p.towardB = !p.towardB;
  dot.path = findPath(world.nav, dot.pos, p.towardB ? p.b : p.a);
}

/** One tick of a living dot: wind up, attack, chase or walk. */
function act(world: World, dot: Dot): void {
  const target = dot.attackTarget ? world.dots.get(dot.attackTarget) : undefined;
  // An order on a dot that died, left or slipped out of sight lapses. A wind-up not yet released goes with it.
  if (dot.attackTarget && (!target || !target.alive || !isVisibleTo(world, target, dot.side))) {
    clearAttack(dot);
    return walk(world, dot);
  }

  if (dot.windUp && target) {
    face(dot, target.pos);
    dot.windUp.elapsed += DT;
    if (dot.windUp.elapsed >= dot.windUp.duration - 1e-9) release(world, dot, target);
    return;
  }

  if (target) {
    if (inRange(world, dot, target)) {
      dot.path = [];
      face(dot, target.pos);
      if (dot.attackReadyIn <= 0) {
        const interval = attackInterval(dot.stats);
        dot.attackReadyIn = interval;
        dot.windUp = { target: target.id, elapsed: 0, duration: interval * world.balance.dot.autoWindUpShare };
      }
      return;
    }
    if (dot.repathIn <= 0 || !dot.path.length) {
      dot.path = isSegmentClear(world.geometry, dot.pos, target.pos, world.balance.dot.radius)
        ? [{ ...target.pos }]
        : findPath(world.nav, dot.pos, target.pos);
      dot.repathIn = CHASE_REPATH;
    }
  }
  walk(world, dot, target);
}

/** Attack range runs from the attacker's centre to the target's edge. */
export function inRange(world: World, dot: Dot, target: Dot): boolean {
  return dist(dot.pos, target.pos) - world.balance.dot.radius <= dot.stats.range + 1e-9;
}

function face(dot: Dot, toward: Vec): void {
  if (toward.x !== dot.pos.x || toward.y !== dot.pos.y) dot.facing = Math.atan2(toward.y - dot.pos.y, toward.x - dot.pos.x);
}

function walk(world: World, dot: Dot, stopFor?: Dot): void {
  let left = dot.stats.moveSpeed * DT;
  while (left > 0 && dot.path.length) {
    // Chasing: stop the moment the target comes into range, rather than walking onto it.
    if (stopFor && inRange(world, dot, stopFor)) {
      dot.path = [];
      break;
    }
    const target = dot.path[0]!;
    const dx = target.x - dot.pos.x;
    const dy = target.y - dot.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) dot.facing = Math.atan2(dy, dx);
    // Chasing, take small steps so the range check above catches the exact moment.
    const stride = stopFor ? Math.min(left, 2) : left;
    if (d <= stride) {
      dot.pos = { ...target };
      dot.path.shift();
      left -= d;
    } else {
      dot.pos = { x: dot.pos.x + (dx / d) * stride, y: dot.pos.y + (dy / d) * stride };
      left -= stride;
    }
  }
  const r = world.balance.dot.radius;
  if (!isClear(world.geometry, dot.pos, r)) dot.pos = pushOut(world.geometry, dot.pos, r);
}

function release(world: World, dot: Dot, target: Dot): void {
  dot.windUp = null;
  dot.lastReleaseTick = world.tick;
  dot.revealedFor = world.balance.dot.brushRevealAfterAttack;
  const damage = dot.stats.attack;
  if (dot.loadout.range === "melee") {
    damageDot(world, dot.id, dot.side, target, damage, "physical");
  } else {
    world.projectiles.push({
      id: world.nextProjectileId++,
      owner: dot.id,
      side: dot.side,
      target: target.id,
      pos: { ...dot.pos },
      speed: world.balance.dot.rangedAutoSpeed,
      damage,
    });
  }
}

function stepProjectiles(world: World): void {
  const r = world.balance.dot.radius;
  world.projectiles = world.projectiles.filter((p) => {
    const target = world.dots.get(p.target);
    if (!target || !target.alive) return false;
    const d = dist(p.pos, target.pos);
    const stride = p.speed * DT;
    if (d - r <= stride) {
      damageDot(world, p.owner, p.side, target, p.damage, "physical");
      return false;
    }
    p.pos = { x: p.pos.x + ((target.pos.x - p.pos.x) / d) * stride, y: p.pos.y + ((target.pos.y - p.pos.y) / d) * stride };
    return true;
  });
}

/** Deals damage after armor or magic resist. Credits the kill to the source, even if the source has died. */
export function damageDot(world: World, sourceId: string, sourceSide: Side, target: Dot, raw: number, type: "physical" | "magic"): void {
  if (!target.alive || world.winner !== null) return;
  const resist = type === "physical" ? target.stats.armor : target.stats.magicResist;
  const amount = Math.min(target.health, mitigate(world.balance, raw, resist));
  target.health -= amount;
  target.damageTaken += amount;
  const source = world.dots.get(sourceId);
  if (source) source.damageDealt += amount;
  world.events.push({ kind: "hit", tick: world.tick, target: target.id, source: sourceId, amount, x: target.pos.x, y: target.pos.y });
  if (target.health > 1e-9) return;

  target.health = 0;
  target.alive = false;
  target.respawnIn = world.balance.dot.respawn;
  target.path = [];
  clearAttack(target);
  target.deaths++;
  if (source) source.kills++;
  world.events.push({ kind: "death", tick: world.tick, target: target.id, source: sourceId });
  world.score[sourceSide]++;
  if (world.score[sourceSide] >= world.balance.match.killsToWin) world.winner = sourceSide;
}

function heal(world: World, dot: Dot): void {
  const baseDepth = world.balance.map.baseDepth;
  const inOwnBase = dot.side === 0 ? dot.pos.x <= baseDepth : dot.pos.x >= world.geometry.length - baseDepth;
  const perSecond = world.balance.dot.regenPerSecond + (inOwnBase ? dot.stats.maxHealth * world.balance.dot.baseHealPerSecond : 0);
  dot.health = Math.min(dot.stats.maxHealth, dot.health + perSecond * DT);
}

/** Starts a fresh match in the same world: score cleared, every dot back home at full health. */
export function resetMatch(world: World): void {
  world.score = [0, 0];
  world.winner = null;
  world.projectiles = [];
  for (const dot of world.dots.values()) {
    respawn(dot);
    clearAttack(dot);
    dot.attackReadyIn = 0;
    dot.kills = dot.deaths = 0;
    dot.damageDealt = dot.damageTaken = 0;
  }
}

/** Target dummy: back to full health. */
export function resetHealth(dot: Dot): void {
  if (dot.alive) dot.health = dot.stats.maxHealth;
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
    dummy: d.dummy,
  };
}

export function selfState(d: Dot): SelfState {
  return {
    x: d.pos.x,
    y: d.pos.y,
    path: d.path.map((p) => ({ ...p })),
    facing: d.facing,
    health: d.health,
    alive: d.alive,
    respawnIn: d.respawnIn,
    attackTarget: d.attackTarget,
    windUp: d.windUp && { ...d.windUp },
    attackReadyIn: d.attackReadyIn,
    repathIn: d.repathIn,
    revealedFor: d.revealedFor,
    lastReleaseTick: d.lastReleaseTick,
  };
}

/** Puts a dot back into the state the server reported, for prediction to rerun from. */
export function applySelfState(d: Dot, s: SelfState): void {
  d.pos = { x: s.x, y: s.y };
  d.path = s.path.map((p) => ({ ...p }));
  d.facing = s.facing;
  d.health = s.health;
  d.alive = s.alive;
  d.respawnIn = s.respawnIn;
  d.attackTarget = s.attackTarget;
  d.windUp = s.windUp && { ...s.windUp };
  d.attackReadyIn = s.attackReadyIn;
  d.repathIn = s.repathIn;
  d.revealedFor = s.revealedFor;
  d.lastReleaseTick = s.lastReleaseTick;
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
    self: own ? selfState(own) : null,
    score: [...world.score],
    winner: world.winner,
    events,
  };
}
