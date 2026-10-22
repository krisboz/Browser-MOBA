import type { AbilityDef, AreaBlockDef, BlockDef, EffectDef, SummonerDef } from "@moba/balance";
import type { CastSlot } from "@moba/protocol";
import { clearAttack, damageDot, face, reveal } from "./combat.js";
import { dist, type Vec } from "./geometry.js";
import { clampToRange, clipLine, setMotion } from "./motion.js";
import { addStatus, effectiveStats, isRooted, isStunned } from "./statuses.js";
import { DT } from "./tick.js";
import type { Dot, SpellCtx, SpellEntity, World } from "./types.js";

export function defFor(world: World, dot: Dot, slot: CastSlot): AbilityDef | SummonerDef | null {
  const id =
    slot === "D" ? dot.loadout.summoners[0] : slot === "F" ? dot.loadout.summoners[1] : dot.loadout.abilities[slot];
  return id ? (world.defs.get(id) ?? null) : null;
}

const movesSelf = (def: AbilityDef | SummonerDef) => def.blocks.some((b) => b.kind === "move");
const style = (def: AbilityDef | SummonerDef) => def.blocks.find((b) => b.kind === "move")?.style;

/** Whether `dot` may start casting `slot` now. */
export function canCast(world: World, dot: Dot, slot: CastSlot): boolean {
  const def = defFor(world, dot, slot);
  if (!def || !dot.alive || isStunned(dot) || dot.cooldowns[slot] > 1e-9) return false;
  if (dot.channel) return false;
  if (movesSelf(def)) {
    // A root stops Dash, Leap and Flash. An anchored thrower may still Flash, but not Dash or Leap.
    if (isRooted(dot)) return false;
    if (dot.anchoredBy !== null && style(def) !== "blink") return false;
  }
  return true;
}

/** A cast command: recast a channel, or start a wind-up, or go off at once if the spell has none. */
export function castSlot(world: World, dot: Dot, slot: CastSlot, aim: Vec): void {
  if (dot.channel?.slot === slot) return fireChannelShot(world, dot, aim);
  if (!canCast(world, dot, slot)) return;
  const def = defFor(world, dot, slot)!;
  // Casting cancels an auto still winding up (refunded) but keeps the attack order.
  if (dot.windUp) {
    dot.windUp = null;
    dot.attackReadyIn = 0;
  }
  dot.cast = null;
  face(dot, aim);
  if (def.windUp > 0) dot.cast = { slot, aim: { ...aim }, elapsed: 0, duration: def.windUp };
  else releaseCast(world, dot, slot, aim);
}

/** One tick of a spell wind-up. Returns false once there is none. */
export function stepCast(world: World, dot: Dot): boolean {
  const c = dot.cast;
  if (!c) return false;
  face(dot, c.aim);
  c.elapsed += DT;
  if (c.elapsed >= c.duration - 1e-9) {
    dot.cast = null;
    releaseCast(world, dot, c.slot, c.aim);
  }
  return true;
}

function makeCtx(world: World, dot: Dot, def: AbilityDef | SummonerDef, spell = true): SpellCtx {
  const stats = effectiveStats(world, dot);
  return {
    caster: dot.id,
    side: dot.side,
    ability: def.id,
    type: "type" in def ? def.type : "none",
    attack: stats.attack,
    magicAttack: stats.magicAttack,
    castInside: world.spells.filter((z) => z.kind === "zone" && dist(dot.pos, z.pos) <= zoneRadius(z)).map((z) => z.id),
    spell,
    blockedOn: [],
  };
}

function releaseCast(world: World, dot: Dot, slot: CastSlot, aim: Vec): void {
  const def = defFor(world, dot, slot);
  if (!def) return;
  // Blocked between starting the wind-up and its release (rooted mid-cast, say): it fizzles, no cooldown spent.
  if (movesSelf(def) && (isRooted(dot) || (dot.anchoredBy !== null && style(def) !== "blink"))) return;
  dot.cooldowns[slot] = def.cooldown;
  dot.lastCastTick = world.tick;
  reveal(world, dot);
  const ctx = makeCtx(world, dot, def);
  for (const block of def.blocks) runBlock(world, dot, ctx, block, slot, aim);
}

function dirTo(dot: Dot, aim: Vec): Vec {
  const d = dist(dot.pos, aim);
  return d > 1e-9 ? { x: (aim.x - dot.pos.x) / d, y: (aim.y - dot.pos.y) / d } : { x: Math.cos(dot.facing), y: Math.sin(dot.facing) };
}

function runBlock(world: World, dot: Dot, ctx: SpellCtx, block: BlockDef, slot: CastSlot, aim: Vec): void {
  switch (block.kind) {
    case "projectile":
      world.spells.push({
        kind: "shot",
        id: world.nextId++,
        ctx,
        pos: { ...dot.pos },
        dir: dirTo(dot, aim),
        speed: block.speed,
        range: block.range,
        traveled: 0,
        width: block.width,
        hits: block.hits,
        falloff: block.falloffAfterFirst,
        returns: block.returns,
        returning: false,
        hitIds: [],
        hitCount: 0,
        onHit: block.onHit,
      });
      return;
    case "hook": {
      const id = world.nextId++;
      world.spells.push({
        kind: "hook",
        id,
        ctx,
        pos: { ...dot.pos },
        dir: dirTo(dot, aim),
        speed: block.speed,
        range: block.range,
        traveled: 0,
        width: block.width,
        retractSpeed: block.retractSpeed,
        state: "out",
        victim: null,
        onHit: block.onHit,
      });
      dot.anchoredBy = id;
      return;
    }
    case "area":
      spawnArea(world, ctx, block.castRange > 0 ? clampToRange(dot.pos, aim, block.castRange) : dot.pos, block);
      return;
    case "empoweredAuto":
      addStatus(world, dot, { kind: "empowered", remaining: block.duration, ctx: { ...ctx, spell: false }, onHit: block.onHit });
      if (block.resetAttackTimer) dot.attackReadyIn = 0;
      return;
    case "move": {
      const target = block.style === "dash" ? { x: dot.pos.x + dirTo(dot, aim).x * block.distance, y: dot.pos.y + dirTo(dot, aim).y * block.distance } : clampToRange(dot.pos, aim, block.distance);
      const to = clipLine(world, dot.pos, target, block.crossesWalls);
      if (block.style === "blink") {
        dot.pos = to;
        // A blink ends your own dash or leap, but not a pull: whoever drags you is still dragging.
        if (dot.motion && dot.motion.kind !== "pull" && dot.motion.kind !== "knockback") dot.motion = null;
        dot.path = [];
      } else {
        setMotion(dot, { kind: block.style, to, speed: block.speed, onLand: block.onLand, ctx });
      }
      return;
    }
    case "zone":
      world.spells.push({
        kind: "zone",
        id: world.nextId++,
        ctx,
        pos: { ...dot.pos },
        radius: block.radius,
        expandTime: block.expandTime,
        age: 0,
        duration: block.duration,
        pushes: block.pushesEnemiesOut,
        blocks: block.blocksSpellsFromOutside,
      });
      return;
    case "channel":
      dot.channel = {
        slot,
        ability: ctx.ability,
        type: ctx.type,
        remaining: block.duration,
        shotsLeft: block.shots,
        shotReadyIn: 0,
        shotInterval: block.shotInterval,
        shot: block.shot,
      };
      dot.path = [];
      clearAttack(dot);
      fireChannelShot(world, dot, aim);
      return;
    case "placed":
      world.spells.push({
        kind: "trap",
        id: world.nextId++,
        ctx,
        pos: world.nav.nearestStandable(clampToRange(dot.pos, aim, block.castRange)),
        radius: block.radius,
        remaining: block.lifetime,
        onEnter: block.onEnter,
      });
      return;
    case "buff":
      addStatus(world, dot, { kind: "buff", remaining: block.duration, duration: block.duration, fades: block.fades, stats: block.stats, ability: ctx.ability });
      return;
    case "shield":
      if (block.blocks === "nextSpell") addStatus(world, dot, { kind: "spellShield", remaining: block.duration });
      else addStatus(world, dot, { kind: "barrier", remaining: block.duration, amount: block.amount });
      return;
    case "heal": {
      const max = effectiveStats(world, dot).maxHealth;
      const amount = Math.min(block.amount, max - dot.health);
      dot.health += amount;
      world.events.push({ kind: "heal", tick: world.tick, target: dot.id, amount, x: dot.pos.x, y: dot.pos.y });
      return;
    }
    case "cleanse":
      dot.statuses = dot.statuses.filter((s) => s.kind !== "stun" && s.kind !== "root" && s.kind !== "slow");
      return;
    case "invisible":
      addStatus(world, dot, { kind: "invisible", remaining: block.duration });
      return;
  }
}

function fireChannelShot(world: World, dot: Dot, aim: Vec): void {
  const ch = dot.channel;
  if (!ch || ch.shotsLeft <= 0 || ch.shotReadyIn > 1e-9 || isStunned(dot)) return;
  const def = world.defs.get(ch.ability);
  if (!def) return;
  face(dot, aim);
  dot.lastCastTick = world.tick;
  spawnArea(world, makeCtx(world, dot, def), clampToRange(dot.pos, aim, ch.shot.castRange), ch.shot);
  ch.shotsLeft--;
  ch.shotReadyIn = ch.shotInterval;
}

/** One tick of a channel. Returns false once there is none. */
export function stepChannel(dot: Dot): boolean {
  const ch = dot.channel;
  if (!ch) return false;
  ch.remaining -= DT;
  ch.shotReadyIn = Math.max(0, ch.shotReadyIn - DT);
  if (ch.remaining <= 1e-9 || ch.shotsLeft <= 0) dot.channel = null;
  return true;
}

function spawnArea(world: World, ctx: SpellCtx, at: Vec, block: AreaBlockDef): void {
  const area: SpellEntity = {
    kind: "area",
    id: world.nextId++,
    ctx,
    pos: { ...at },
    radius: block.radius,
    timing: block.timing,
    delay: block.delay,
    delayLeft: block.timing === "instant" ? 0 : block.delay,
    remaining: block.timing === "lasting" ? block.duration : AREA_AFTERGLOW,
    armed: false,
    onHit: block.onHit,
    whileInside: block.whileInside,
    hitIds: [],
  };
  world.spells.push(area);
  if (block.timing === "instant") armArea(world, area);
}

/** A leap's landing area: goes off where the dot came down. */
export function spawnLandingArea(world: World, ctx: SpellCtx, at: Vec, block: AreaBlockDef): void {
  spawnArea(world, ctx, at, block);
}

// Seconds an instant or delayed area stays drawn after going off, so it reads on screen.
const AREA_AFTERGLOW = 0.2;

function armArea(world: World, area: Extract<SpellEntity, { kind: "area" }>): void {
  area.armed = true;
  hitArea(world, area);
}

function hitArea(world: World, area: Extract<SpellEntity, { kind: "area" }>): void {
  const r = world.balance.dot.radius;
  for (const dot of world.dots.values()) {
    if (!dot.alive || dot.side === area.ctx.side || dist(dot.pos, area.pos) > area.radius + r) continue;
    if (!area.hitIds.includes(dot.id)) {
      area.hitIds.push(dot.id);
      applyEffects(world, area.ctx, dot, area.onHit, area.pos);
    }
    if (area.timing === "lasting" && area.whileInside.length) applyEffects(world, area.ctx, dot, area.whileInside, area.pos);
  }
}

export const zoneRadius = (z: Extract<SpellEntity, { kind: "zone" }>) =>
  z.expandTime > 0 ? z.radius * Math.min(1, z.age / z.expandTime) : z.radius;

/** Domes that stop `ctx` at `at`: enemy domes it wasn't cast inside. */
function blockingZoneAt(world: World, ctx: SpellCtx, at: Vec): Extract<SpellEntity, { kind: "zone" }> | null {
  if (!ctx.spell) return null;
  for (const z of world.spells) {
    if (z.kind !== "zone" || !z.blocks || z.ctx.side === ctx.side || ctx.castInside.includes(z.id)) continue;
    if (dist(at, z.pos) <= zoneRadius(z)) return z;
  }
  return null;
}

/**
 * Applies effects from one cast to one dot. A spell is stopped first by an enemy dome the target stands in
 * (unless it was cast inside that dome), then by a spell shield, which it uses up. Returns whether it got through.
 */
export function applyEffects(world: World, ctx: SpellCtx, target: Dot, effects: EffectDef[], origin: Vec, scale = 1): boolean {
  if (ctx.spell) {
    if (ctx.blockedOn.includes(target.id)) return false;
    if (blockingZoneAt(world, ctx, target.pos)) return false;
    const shield = target.statuses.find((s) => s.kind === "spellShield");
    if (shield) {
      target.statuses = target.statuses.filter((s) => s !== shield);
      ctx.blockedOn.push(target.id);
      world.events.push({ kind: "blocked", tick: world.tick, target: target.id, source: ctx.caster, x: target.pos.x, y: target.pos.y });
      return false;
    }
  }
  for (const e of effects) {
    if (!target.alive) break;
    switch (e.kind) {
      case "damage": {
        let raw = (e.base + e.ratio * (ctx.type === "magic" ? ctx.magicAttack : ctx.attack)) * scale;
        if (e.missingHealthBonus) raw *= 1 + e.missingHealthBonus * (1 - target.health / effectiveStats(world, target).maxHealth);
        damageDot(world, ctx.caster, ctx.side, target, raw, ctx.type === "magic" ? "magic" : "physical", ctx.ability);
        break;
      }
      case "root":
        addStatus(world, target, { kind: "root", remaining: e.duration });
        break;
      case "stun":
        addStatus(world, target, { kind: "stun", remaining: e.duration });
        break;
      case "slow":
        addStatus(world, target, { kind: "slow", remaining: e.duration, amount: e.amount });
        break;
      case "knockback": {
        const d = dist(origin, target.pos);
        const dir = d > 1e-9 ? { x: (target.pos.x - origin.x) / d, y: (target.pos.y - origin.y) / d } : { x: 1, y: 0 };
        const to = clipLine(world, target.pos, { x: target.pos.x + dir.x * e.distance, y: target.pos.y + dir.y * e.distance }, false);
        setMotion(target, { kind: "knockback", to, speed: e.speed });
        break;
      }
      case "applyMark":
        addStatus(world, target, {
          kind: "mark",
          remaining: e.duration,
          source: ctx.caster,
          stacks: 0,
          of: e.hitsToDetonate,
          ctx: { ...ctx, blockedOn: [] },
          onDetonate: e.onDetonate,
        });
        break;
    }
  }
  return true;
}

/** First enemy dot (or all, in order) a circle of `width` sweeping from `a` to `b` touches. */
function sweep(world: World, ctx: SpellCtx, a: Vec, b: Vec, width: number, skip: string[]): { dot: Dot; t: number }[] {
  const R = world.balance.dot.radius + width / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const hits: { dot: Dot; t: number }[] = [];
  for (const dot of world.dots.values()) {
    if (!dot.alive || dot.side === ctx.side || skip.includes(dot.id)) continue;
    // Earliest t in [0, 1] where |a + t(b - a) - c| <= R.
    const fx = a.x - dot.pos.x;
    const fy = a.y - dot.pos.y;
    const c = fx * fx + fy * fy - R * R;
    if (c <= 0) {
      hits.push({ dot, t: 0 });
      continue;
    }
    if (len2 < 1e-12) continue;
    const bq = 2 * (fx * dx + fy * dy);
    const disc = bq * bq - 4 * len2 * c;
    if (disc < 0) continue;
    const t = (-bq - Math.sqrt(disc)) / (2 * len2);
    if (t >= 0 && t <= 1) hits.push({ dot, t });
  }
  return hits.sort((p, q) => p.t - q.t);
}

const towards = (from: Vec, to: Vec, stride: number): { pos: Vec; arrived: boolean } => {
  const d = dist(from, to);
  if (d <= stride) return { pos: { ...to }, arrived: true };
  return { pos: { x: from.x + ((to.x - from.x) / d) * stride, y: from.y + ((to.y - from.y) / d) * stride }, arrived: false };
};

/** Moves every spell in play one tick and lets it hit. */
export function stepSpells(world: World): void {
  const r = world.balance.dot.radius;
  // Every spell stays visible to the others while they step (a dome must be there for a bolt to hit it).
  // Spells spawned while stepping (a landing area, say) move from next tick.
  const done = new Set<SpellEntity>();
  for (const s of [...world.spells]) {
    if (!stepSpell(world, s, r)) done.add(s);
  }
  world.spells = world.spells.filter((s) => !done.has(s));
}

function stepSpell(world: World, s: SpellEntity, r: number): boolean {
  switch (s.kind) {
    case "shot": {
      const caster = world.dots.get(s.ctx.caster);
      const from = s.pos;
      let to: Vec;
      let done = false;
      if (s.returning) {
        if (!caster || !caster.alive) return false;
        const step = towards(from, caster.pos, s.speed * DT);
        to = step.pos;
        done = step.arrived || dist(to, caster.pos) <= r;
      } else {
        const stride = Math.min(s.speed * DT, s.range - s.traveled);
        to = { x: from.x + s.dir.x * stride, y: from.y + s.dir.y * stride };
        s.traveled += stride;
      }
      for (const { dot } of sweep(world, s.ctx, from, to, s.width, s.hitIds)) {
        s.hitIds.push(dot.id);
        applyEffects(world, s.ctx, dot, s.onHit, from, s.hitCount === 0 ? 1 : 1 - s.falloff);
        s.hitCount++;
        if (s.hits === "first") return false;
      }
      s.pos = to;
      if (blockingZoneAt(world, s.ctx, s.pos)) return false;
      if (done) return false;
      if (!s.returning && s.traveled >= s.range - 1e-9) {
        if (!s.returns) return false;
        s.returning = true;
        s.hitIds = [];
      }
      return true;
    }
    case "hook":
      return stepHook(world, s, r);
    case "area": {
      if (!s.armed) {
        s.delayLeft -= DT;
        if (s.delayLeft <= 1e-9) armArea(world, s);
        return true;
      }
      s.remaining -= DT;
      if (s.timing === "lasting" && s.remaining > 1e-9) hitArea(world, s);
      return s.remaining > 1e-9;
    }
    case "zone": {
      s.age += DT;
      if (s.pushes) {
        const radius = zoneRadius(s);
        for (const dot of world.dots.values()) {
          if (!dot.alive || dot.side === s.ctx.side) continue;
          const d = dist(dot.pos, s.pos);
          if (d >= radius + r) continue;
          // Pushed to the edge. A push is a forced movement, so it ends any other one in progress.
          const dir = d > 1e-9 ? { x: (dot.pos.x - s.pos.x) / d, y: (dot.pos.y - s.pos.y) / d } : { x: 1, y: 0 };
          dot.pos = clipLine(world, dot.pos, { x: s.pos.x + dir.x * (radius + r), y: s.pos.y + dir.y * (radius + r) }, true);
          dot.motion = null;
        }
      }
      return s.age < s.duration - 1e-9;
    }
    case "trap": {
      s.remaining -= DT;
      for (const dot of world.dots.values()) {
        if (!dot.alive || dot.side === s.ctx.side || dist(dot.pos, s.pos) > s.radius + r) continue;
        applyEffects(world, s.ctx, dot, s.onEnter, s.pos);
        return false;
      }
      return s.remaining > 1e-9;
    }
  }
}

function stepHook(world: World, h: Extract<SpellEntity, { kind: "hook" }>, r: number): boolean {
  const owner = world.dots.get(h.ctx.caster);
  const done = () => {
    if (owner && owner.anchoredBy === h.id) owner.anchoredBy = null;
    return false;
  };
  if (!owner || !owner.alive) return done();

  if (h.state === "out") {
    // The hook flies on its own: where the thrower is now doesn't matter until it comes back.
    const from = h.pos;
    const stride = Math.min(h.speed * DT, h.range - h.traveled);
    const to = { x: from.x + h.dir.x * stride, y: from.y + h.dir.y * stride };
    h.traveled += stride;
    const hit = sweep(world, h.ctx, from, to, h.width, [])[0];
    if (hit) {
      h.pos = { ...hit.dot.pos };
      if (applyEffects(world, h.ctx, hit.dot, h.onHit, from) && hit.dot.alive) {
        setMotion(hit.dot, { kind: "pull", toward: owner.id, speed: h.retractSpeed, hook: h.id });
        h.state = "pulling";
        h.victim = hit.dot.id;
      } else {
        h.state = "returning";
      }
      return true;
    }
    h.pos = to;
    if (blockingZoneAt(world, h.ctx, h.pos) || h.traveled >= h.range - 1e-9) h.state = "returning";
    return true;
  }

  if (h.state === "pulling") {
    const victim = h.victim ? world.dots.get(h.victim) : undefined;
    const stillPulling = victim?.alive && victim.motion?.kind === "pull" && victim.motion.hook === h.id;
    if (stillPulling) {
      h.pos = { ...victim.pos };
      return true;
    }
    // Arrived next to the thrower: the hook is back. Anything else (a newer movement, a death): it comes back empty.
    if (victim?.alive && dist(victim.pos, owner.pos) <= 2 * r + 1) return done();
    if (victim) h.pos = { ...victim.pos };
    h.state = "returning";
    h.victim = null;
  }

  const step = towards(h.pos, owner.pos, h.retractSpeed * DT);
  h.pos = step.pos;
  if (step.arrived || dist(h.pos, owner.pos) <= r) return done();
  return true;
}
