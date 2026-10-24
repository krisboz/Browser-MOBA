import type { EffectDef } from "@moba/balance";
import type { Side } from "@moba/protocol";
import { inOwnBase, matchTime, payForKill } from "./economy.js";
import { dist, isClear, isSegmentClear, pushOut, type Vec } from "./geometry.js";
import { callForHelp, towerShotDamage } from "./lane.js";
import { findPath } from "./nav.js";
import { applyEffects } from "./spells.js";
import { attackInterval, mitigate } from "./stats.js";
import { canWalk, effectiveStats, isInvisible } from "./statuses.js";
import { DT } from "./tick.js";
import type { Dot, SpellCtx, World } from "./types.js";
import { isVisibleTo } from "./vision.js";

// How often a dot chasing an attack target re-plans its path, in seconds.
const CHASE_REPATH = 0.25;

/** Drops the attack order and any wind-up not yet released. Nothing fires; the attack timer is refunded. */
export function clearAttack(dot: Dot): void {
  dot.attackTarget = null;
  if (dot.windUp) {
    dot.windUp = null;
    dot.attackReadyIn = 0;
  }
}

/** Attack range runs from the attacker's centre to the target's edge. */
export function inRange(_world: World, dot: Dot, target: Dot): boolean {
  return dist(dot.pos, target.pos) - target.radius <= dot.stats.range + 1e-9;
}

/** How a unit's autos go: the share of the attack interval spent winding up, and how fast a ranged shot flies. */
function autoStyle(world: World, dot: Dot): { windUpShare: number; shotSpeed: number } {
  const b = world.balance;
  switch (dot.kind) {
    case "dot":
      return { windUpShare: b.dot.autoWindUpShare, shotSpeed: b.dot.rangedAutoSpeed };
    case "minion":
      return { windUpShare: b.minions.autoWindUpShare, shotSpeed: b.minions.shotSpeed };
    case "tower":
      return { windUpShare: b.towers.autoWindUpShare, shotSpeed: b.towers.shotSpeed };
  }
}

export function face(dot: Dot, toward: Vec): void {
  if (toward.x !== dot.pos.x || toward.y !== dot.pos.y) dot.facing = Math.atan2(toward.y - dot.pos.y, toward.x - dot.pos.x);
}

/** Auto attacking and walking, for a dot free to act this tick. */
export function attackOrWalk(world: World, dot: Dot): void {
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
        const interval = attackInterval(effectiveStats(world, dot));
        dot.attackReadyIn = interval;
        dot.windUp = { target: target.id, elapsed: 0, duration: interval * autoStyle(world, dot).windUpShare };
      }
      return;
    }
    if (canWalk(dot) && (dot.repathIn <= 0 || !dot.path.length)) {
      dot.path = isSegmentClear(world.geometry, dot.pos, target.pos, dot.radius)
        ? [{ ...target.pos }]
        : findPath(world.nav, dot.pos, target.pos);
      dot.repathIn = CHASE_REPATH;
    }
  }
  walk(world, dot, target);
}

export function walk(world: World, dot: Dot, stopFor?: Dot): void {
  if (!canWalk(dot)) return;
  let left = effectiveStats(world, dot).moveSpeed * DT;
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
  if (!isClear(world.geometry, dot.pos, dot.radius)) dot.pos = pushOut(world.geometry, dot.pos, dot.radius);
}

/** Attacking or casting shows you: out of brush for a moment, and out of invisibility for good. */
export function reveal(world: World, dot: Dot): void {
  dot.revealedFor = world.balance.dot.brushRevealAfterAttack;
  if (isInvisible(dot)) dot.statuses = dot.statuses.filter((s) => s.kind !== "invisible");
}

function release(world: World, dot: Dot, target: Dot): void {
  dot.windUp = null;
  dot.lastReleaseTick = world.tick;
  reveal(world, dot);
  const empowered = dot.statuses.find((s) => s.kind === "empowered");
  if (empowered) dot.statuses = dot.statuses.filter((s) => s !== empowered);
  const bonus = empowered?.kind === "empowered" ? { ctx: empowered.ctx, onHit: empowered.onHit } : null;
  const attack = effectiveStats(world, dot).attack;
  const damage = dot.kind === "tower" ? towerShotDamage(world, dot, target, attack) : attack;
  if (dot.loadout.range === "melee") {
    landAuto(world, dot.id, dot.side, target, damage, bonus, dot.pos);
  } else {
    world.projectiles.push({
      id: world.nextId++,
      owner: dot.id,
      side: dot.side,
      target: target.id,
      pos: { ...dot.pos },
      speed: autoStyle(world, dot).shotSpeed,
      damage,
      bonus,
    });
  }
}

/** An auto landing: its damage, then any mark it advances, then any empowered effects it carries. */
function landAuto(
  world: World,
  ownerId: string,
  side: Side,
  target: Dot,
  damage: number,
  bonus: { ctx: SpellCtx; onHit: EffectDef[] } | null,
  from: Vec,
): void {
  damageDot(world, ownerId, side, target, damage, "physical", null);
  if (!target.alive) return;
  const mark = target.statuses.find((s) => s.kind === "mark" && s.source === ownerId);
  if (mark?.kind === "mark") {
    mark.stacks++;
    if (mark.stacks >= mark.of) {
      target.statuses = target.statuses.filter((s) => s !== mark);
      applyEffects(world, mark.ctx, target, mark.onDetonate, from);
    }
  }
  if (bonus && target.alive) applyEffects(world, bonus.ctx, target, bonus.onHit, from);
}

export function stepProjectiles(world: World): void {
  world.projectiles = world.projectiles.filter((p) => {
    const target = world.dots.get(p.target);
    if (!target || !target.alive) return false;
    const d = dist(p.pos, target.pos);
    const stride = p.speed * DT;
    if (d - target.radius <= stride) {
      landAuto(world, p.owner, p.side, target, p.damage, p.bonus, p.pos);
      return false;
    }
    p.pos = { x: p.pos.x + ((target.pos.x - p.pos.x) / d) * stride, y: p.pos.y + ((target.pos.y - p.pos.y) / d) * stride };
    return true;
  });
}

/**
 * Deals damage after armor or magic resist; a barrier soaks it first. Credits the kill to the source, even if
 * the source has died. `ability` is null for a plain auto.
 */
export function damageDot(
  world: World,
  sourceId: string,
  sourceSide: Side,
  target: Dot,
  raw: number,
  type: "physical" | "magic",
  ability: string | null,
): void {
  if (!target.alive || world.winner !== null) return;
  const stats = effectiveStats(world, target);
  let amount = mitigate(world.balance, raw, type === "physical" ? stats.armor : stats.magicResist);
  const dealt = amount;
  for (const s of target.statuses) {
    if (s.kind !== "barrier" || amount <= 0) continue;
    const soaked = Math.min(s.amount, amount);
    s.amount -= soaked;
    amount -= soaked;
  }
  amount = Math.min(target.health, amount);
  target.health -= amount;
  target.damageTaken += amount;
  const source = world.dots.get(sourceId);
  if (source) source.damageDealt += amount;
  world.events.push({ kind: "hit", tick: world.tick, target: target.id, source: sourceId, amount: dealt, x: target.pos.x, y: target.pos.y, ability });
  if (source?.kind === "dot" && target.kind === "dot" && source.side !== target.side) callForHelp(world, source, target);
  if (target.health > 1e-9) return;
  kill(world, target, sourceId, sourceSide);
}

/** Any unit dying. Only a dot's death scores, and only dots respawn; a minion leaves the world, a tower stays fallen. */
function kill(world: World, target: Dot, sourceId: string, sourceSide: Side): void {
  target.health = 0;
  target.alive = false;
  target.respawnIn = target.kind === "dot" ? world.balance.dot.respawn : 0;
  target.path = [];
  clearAttack(target);
  target.statuses = [];
  target.motion = null;
  target.cast = null;
  target.channel = null;
  // Its hook goes with it; whoever it was dragging stops (their pull has nobody to drag them to).
  world.spells = world.spells.filter((s) => !(s.kind === "hook" && s.ctx.caster === target.id));
  target.anchoredBy = null;
  world.events.push({ kind: "death", tick: world.tick, target: target.id, source: sourceId });
  // Paid before the kill is counted, so the comeback multiplier sees the score as it was.
  payForKill(world, target, sourceId, sourceSide);
  if (target.kind !== "dot") return;
  target.deaths++;
  const source = world.dots.get(sourceId);
  if (source) {
    source.kills++;
    source.killTimes.push(matchTime(world));
  }
  world.score[sourceSide]++;
  if (world.score[sourceSide] >= world.balance.match.killsToWin) world.winner = sourceSide;
}

/** Dots only: passive regeneration, and the base heal. */
export function heal(world: World, dot: Dot): void {
  if (dot.kind !== "dot") return;
  const perSecond = world.balance.dot.regenPerSecond + (inOwnBase(world, dot) ? dot.stats.maxHealth * world.balance.dot.baseHealPerSecond : 0);
  dot.health = Math.min(effectiveStats(world, dot).maxHealth, dot.health + perSecond * DT);
}
