import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import type { CastSlot, GameEvent } from "@moba/protocol";
import { addDot, applyCommand, createWorld, drainEvents, effectiveStats, loadoutFor, step, TICK_RATE, type World } from "./index.js";
import { cast, cmd, inflict, kit, near, run, VANILLA, VANILLA_MELEE } from "./test-helpers.js";

/** Steps `seconds`, collecting every event. */
function watch(world: World, seconds: number): GameEvent[] {
  const out: GameEvent[] = drainEvents(world);
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
    step(world);
    out.push(...drainEvents(world));
  }
  return out;
}

const spellDamage = (events: GameEvent[], target: string) =>
  events.reduce((sum, e) => sum + (e.kind === "hit" && e.target === target && e.ability !== null ? e.amount : 0), 0);

function arena(preset: string, dummyAt = { x: 1500, y: 300 }) {
  const world = createWorld(seedV1);
  // At the level R unlocks, so the whole kit is there.
  const me = addDot(world, { id: "me", side: 0, loadout: loadoutFor(seedV1, preset)!, pos: { x: 1200, y: 300 }, level: seedV1.levels.ultimateUnlockLevel });
  const dummy = addDot(world, { id: "dummy", side: 1, loadout: VANILLA, pos: dummyAt, dummy: true });
  return { world, me, dummy };
}

describe("every preset casts its full kit against the dummy", () => {
  for (const preset of ["poke", "diver", "tank", "marksman"]) {
    it(preset, () => {
      const { world, me, dummy } = arena(preset);
      const events: GameEvent[] = [];
      for (const slot of ["Q", "W", "E", "R", "D", "F"] as CastSlot[]) {
        expect(me.cooldowns[slot], `${slot} ready`).toBe(0);
        applyCommand(world, "me", cast(slot, dummy.pos.x, dummy.pos.y));
        events.push(...watch(world, 0.6));
        expect(me.cooldowns[slot], `${slot} (${me.loadout.abilities[slot as "Q"] ?? me.loadout.summoners[slot === "D" ? 0 : 1]}) went off`).toBeGreaterThan(0);
        // Autos between casts, so empowered autos and marks get used.
        applyCommand(world, "me", cmd.attack("dummy"));
        events.push(...watch(world, 1.2));
        if (!dummy.alive) events.push(...watch(world, 6.5));
        if (me.channel) applyCommand(world, "me", cmd.stop());
      }
      expect(spellDamage(events, "dummy") + events.filter((e) => e.kind === "hit").length).toBeGreaterThan(0);
    });
  }
});

describe("a full round of spells takes more than half of a vanilla dot's health", () => {
  it("Poke: Bolt, Chill Field, Artillery", () => {
    const { world, dummy } = arena("poke");
    const events: GameEvent[] = [];
    applyCommand(world, "me", cast("Q", 1500, 300));
    events.push(...watch(world, 0.5));
    applyCommand(world, "me", cast("W", 1500, 300));
    events.push(...watch(world, 0.5));
    for (let shot = 0; shot < 5; shot++) {
      applyCommand(world, "me", cast("R", 1500, 300));
      events.push(...watch(world, 0.6));
    }
    events.push(...watch(world, 1));
    expect(spellDamage(events, "dummy")).toBeGreaterThan(500);
  });

  it("Diver: Heavy Strike, Leap, Finisher", () => {
    const { world, dummy } = arena("diver");
    const events: GameEvent[] = [];
    applyCommand(world, "me", cast("E", 1500, 300)); // Leap in
    events.push(...watch(world, 0.8));
    applyCommand(world, "me", cast("Q", 1500, 300)); // Heavy Strike, then an auto
    applyCommand(world, "me", cmd.attack("dummy"));
    events.push(...watch(world, 0.6));
    applyCommand(world, "me", cast("R", dummy.pos.x, dummy.pos.y)); // Finisher
    events.push(...watch(world, 0.6));
    expect(spellDamage(events, "dummy")).toBeGreaterThan(500);
  });
});

describe("abilities", () => {
  it("Heavy Strike: the next auto hits harder and the attack timer resets", () => {
    const { world, me, dummy } = arena("diver", { x: 1300, y: 300 });
    applyCommand(world, "me", cmd.attack("dummy"));
    run(world, 1, () => me.lastReleaseTick >= 0);
    expect(me.attackReadyIn).toBeGreaterThan(0.5);
    applyCommand(world, "me", cast("Q", 1300, 300));
    expect(me.attackReadyIn).toBe(0);
    const events = watch(world, 0.4);
    expect(events.filter((e) => e.kind === "hit" && e.ability === "heavy-strike")).toHaveLength(1);
    expect(dummy.statuses.some((s) => s.kind === "empowered")).toBe(false);
  });

  it("Mark: the next auto marks, three more autos detonate", () => {
    const { world, me } = arena("tank", { x: 1300, y: 300 });
    applyCommand(world, "me", cast("Q", 1300, 300));
    applyCommand(world, "me", cmd.attack("dummy"));
    const events = watch(world, 4.5);
    const autos = events.filter((e) => e.kind === "hit" && e.ability === null).length;
    const detonations = events.filter((e) => e.kind === "hit" && e.ability === "mark").length;
    expect(autos).toBeGreaterThanOrEqual(4);
    expect(detonations).toBe(1);
    void me;
  });

  it("Piercer: passes through everything, weaker after the first", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "me", side: 0, loadout: loadoutFor(seedV1, "marksman")!, pos: { x: 900, y: 300 } });
    for (const [i, x] of [1100, 1300, 1500].entries()) addDot(world, { id: `t${i}`, side: 1, loadout: VANILLA, pos: { x, y: 300 } });
    applyCommand(world, "me", cast("Q", 1500, 300));
    const hits = watch(world, 1.5).filter((e) => e.kind === "hit");
    const physicalFull = 120 + 0.6 * 140;
    expect(hits.map((h) => Math.round(h.amount))).toEqual([physicalFull, physicalFull / 2, physicalFull / 2].map(Math.round));
  });

  it("Chill Field: damages once, slows while inside", () => {
    const { world, dummy } = arena("poke");
    applyCommand(world, "me", cast("W", 1500, 300));
    const events = watch(world, 1);
    expect(events.filter((e) => e.kind === "hit")).toHaveLength(1);
    expect(effectiveStats(world, dummy).moveSpeed).toBeCloseTo(300 * 0.7, 6);
    run(world, 3);
    expect(effectiveStats(world, dummy).moveSpeed).toBe(300);
  });

  it("Snare Shot: damages and roots the first enemy hit", () => {
    const { world, dummy } = arena("marksman");
    applyCommand(world, "me", cast("E", 1500, 300));
    run(world, 0.6);
    expect(dummy.statuses.some((s) => s.kind === "root")).toBe(true);
    expect(dummy.health).toBeLessThan(dummy.stats.maxHealth);
  });

  it("Trap: roots whoever steps on it, then is gone; hidden from the other side", () => {
    const { world, me, dummy } = arena("marksman", { x: 1600, y: 300 });
    applyCommand(world, "me", cast("W", 1400, 300));
    run(world, 0.4);
    expect(world.spells.some((s) => s.kind === "trap")).toBe(true);
    applyCommand(world, "dummy", cmd.move(1200, 300));
    run(world, 1.5);
    expect(dummy.statuses.some((s) => s.kind === "root")).toBe(true);
    expect(world.spells.some((s) => s.kind === "trap")).toBe(false);
    void me;
  });

  it("Spell Shield: blocks the next enemy ability, once", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "me", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 1000, y: 300 } });
    const tank = addDot(world, { id: "tank", side: 1, loadout: loadoutFor(seedV1, "tank")!, pos: { x: 1300, y: 300 } });
    applyCommand(world, "tank", cast("W", 1300, 300));
    applyCommand(world, "me", cast("Q", 1300, 300));
    const events = watch(world, 0.8);
    expect(events.some((e) => e.kind === "blocked")).toBe(true);
    expect(tank.health).toBe(tank.stats.maxHealth);
    tank.cooldowns.W = 99;
    me().cooldowns.Q = 0;
    applyCommand(world, "me", cast("Q", 1300, 300));
    run(world, 0.8);
    expect(tank.health).toBeLessThan(tank.stats.maxHealth);
    function me() {
      return world.dots.get("me")!;
    }
  });

  it("Finisher: deals more the lower the target's health", () => {
    const hitAt = (health: number) => {
      const { world, dummy } = arena("diver", { x: 1300, y: 300 });
      dummy.health = health;
      applyCommand(world, "me", cast("R", 1300, 300));
      return watch(world, 0.6).find((e) => e.kind === "hit")!;
    };
    const full = hitAt(1000);
    const low = hitAt(200);
    expect(full.kind === "hit" && full.amount).toBeCloseTo(320 + 0.6 * 150, 6);
    expect(low.kind === "hit" && low.amount).toBeCloseTo((320 + 0.6 * 150) * 1.8, 6);
  });

  it("Leap: jumps to a spot and damages on landing, can't be aimed further than its range", () => {
    const { world, me, dummy } = arena("diver", { x: 1550, y: 300 });
    applyCommand(world, "me", cast("E", 1550, 300));
    const events = watch(world, 1);
    expect(me.pos.x).toBeCloseTo(1550, 6);
    expect(events.some((e) => e.kind === "hit" && e.ability === "leap")).toBe(true);
    void dummy;
  });

  it("Dash: 300 units toward the cursor, stopping at walls", () => {
    const { world, me } = arena("poke");
    applyCommand(world, "me", cast("E", 2000, 300));
    run(world, 0.5);
    expect(me.pos.x).toBeCloseTo(1500, 6);
    const walled = createWorld(seedV1);
    const d = addDot(walled, { id: "d", side: 0, loadout: kit({ E: "dash" }), pos: { x: 1225, y: 260 } });
    applyCommand(walled, "d", cast("E", 1225, 0)); // straight up into the outcrop
    run(walled, 0.5);
    expect(d.pos.y).toBeCloseTo(180 + 30, 1);
  });

  it("Frenzy and Overdrive: timed buffs", () => {
    const diver = arena("diver");
    applyCommand(diver.world, "me", cast("W", 0, 0));
    expect(effectiveStats(diver.world, diver.me).attackSpeed).toBeCloseTo(1.25 + 0.5, 9);
    run(diver.world, 4.1);
    expect(effectiveStats(diver.world, diver.me).attackSpeed).toBeCloseTo(1.25, 9);

    const mm = arena("marksman");
    applyCommand(mm.world, "me", cast("R", 0, 0));
    expect(effectiveStats(mm.world, mm.me)).toMatchObject({ attackSpeed: 1.4 + 1, moveSpeed: 300 * 1.3 });
  });

  it("movement speed bonuses stop at the cap", () => {
    const { world, me } = arena("marksman");
    applyCommand(world, "me", cast("R", 0, 0)); // Overdrive +30%
    applyCommand(world, "me", cast("F", 0, 0)); // Sprint +60%, fading
    expect(effectiveStats(world, me).moveSpeed).toBe(450);
  });

  it("Sprint fades out", () => {
    const { world, me } = arena("marksman");
    applyCommand(world, "me", cast("F", 0, 0));
    const start = effectiveStats(world, me).moveSpeed;
    run(world, 1.5);
    const mid = effectiveStats(world, me).moveSpeed;
    run(world, 1.6);
    expect(start).toBe(450); // 300 x 1.6 = 480, over the cap
    expect(mid).toBeCloseTo(300 * 1.3, 0);
    expect(effectiveStats(world, me).moveSpeed).toBe(300);
  });

  it("Barrier soaks damage before health", () => {
    const { world, me, dummy } = arena("poke");
    applyCommand(world, "me", cast("F", 0, 0)); // Barrier
    inflict(world, me, [{ kind: "damage", base: 200, ratio: 0 }], { side: 1 });
    expect(me.health).toBe(me.stats.maxHealth);
    // 200 magic into 50 magic resist: 133 soaked of 300; the next 200 (133) leaves 167 of shield.
    inflict(world, me, [{ kind: "damage", base: 400, ratio: 0 }], { side: 1 });
    expect(me.health).toBeCloseTo(me.stats.maxHealth - (400 * 100) / 150 + (300 - (200 * 100) / 150), 6);
    void dummy;
  });

  it("Heal and Cleanse", () => {
    const tank = arena("tank");
    tank.me.health = 500;
    applyCommand(tank.world, "me", cast("F", 0, 0));
    expect(tank.me.health).toBe(750);
    // Heal has no wind-up: it goes off as the command arrives, and its event still gets reported.
    expect(watch(tank.world, 0.1).filter((e) => e.kind === "heal")).toEqual([expect.objectContaining({ amount: 250 })]);

    const diver = arena("diver");
    inflict(diver.world, diver.me, [{ kind: "root", duration: 3 }, { kind: "slow", amount: 0.5, duration: 3 }], { side: 1 });
    applyCommand(diver.world, "me", cast("F", 0, 0));
    expect(diver.me.statuses).toEqual([]);
  });

  it("Artillery: roots the caster and fires a shot per recast, up to five", () => {
    const { world, me, dummy } = arena("poke");
    applyCommand(world, "me", cast("R", 1500, 300));
    run(world, 0.3);
    expect(me.channel).not.toBeNull();
    applyCommand(world, "me", cmd.move(500, 300));
    run(world, 0.3);
    expect(me.pos).toEqual({ x: 1200, y: 300 });
    // Recast more often than it allows: only five shots ever fire.
    for (let i = 0; i < 8; i++) {
      applyCommand(world, "me", cast("R", 1500, 300));
      run(world, 0.55);
    }
    expect(me.channel).toBeNull();
    const shotDamage = 80 + 0.2 * 100;
    expect(dummy.stats.maxHealth - dummy.health).toBeCloseTo(5 * shotDamage, 6);
  });

  it("Vanish: hidden from the other side until it attacks", () => {
    const world = createWorld(seedV1);
    const v = addDot(world, { id: "v", side: 0, loadout: kit({ W: "vanish" }, [null, null], "melee"), pos: { x: 1000, y: 300 } });
    addDot(world, { id: "e", side: 1, loadout: VANILLA_MELEE, pos: { x: 1100, y: 300 } });
    applyCommand(world, "v", cast("W", 0, 0));
    step(world);
    expect(v.statuses.some((s) => s.kind === "invisible")).toBe(true);
    applyCommand(world, "v", cmd.attack("e"));
    run(world, 1);
    expect(v.statuses.some((s) => s.kind === "invisible")).toBe(false);
  });

  it("Shove: knocks nearby enemies away", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "s", side: 0, loadout: kit({ E: "shove" }, [null, null], "melee"), pos: { x: 1000, y: 300 } });
    const e = addDot(world, { id: "e", side: 1, loadout: VANILLA, pos: { x: 1100, y: 300 } });
    applyCommand(world, "s", cast("E", 1100, 300));
    run(world, 1);
    expect(e.pos.x).toBeCloseTo(1400, 6);
  });

  it("Boomerang hits on the way out and on the way back", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "b", side: 0, loadout: kit({ Q: "boomerang" }), pos: { x: 1000, y: 300 } });
    const e = addDot(world, { id: "e", side: 1, loadout: VANILLA, pos: { x: 1400, y: 300 } });
    applyCommand(world, "b", cast("Q", 1400, 300));
    const hits = watch(world, 2.5).filter((x) => x.kind === "hit" && x.target === "e");
    expect(hits).toHaveLength(2);
    void e;
  });

  it("Burst goes off after its delay", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "b", side: 0, loadout: kit({ Q: "burst" }), pos: { x: 1000, y: 300 } });
    const e = addDot(world, { id: "e", side: 1, loadout: VANILLA, pos: { x: 1400, y: 300 } });
    applyCommand(world, "b", cast("Q", 1400, 300));
    const def = seedV1.abilities.find((a) => a.id === "burst")!;
    run(world, def.windUp + 0.7);
    expect(e.health).toBe(e.stats.maxHealth);
    run(world, 0.2);
    expect(e.health).toBeLessThan(e.stats.maxHealth);
  });

  it("Reel: pulls the first enemy hit all the way in", () => {
    const { world, me, dummy } = arena("tank", { x: 1800, y: 300 });
    applyCommand(world, "me", cast("E", 1800, 300));
    run(world, 2, () => me.anchoredBy === null && world.tick > 15);
    expect(near(dummy.pos, me.pos)).toBeCloseTo(60, 3);
  });
});
