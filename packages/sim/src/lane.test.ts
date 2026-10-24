import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import type { GameEvent } from "@moba/protocol";
import { addDot, applyCommand, createWorld, drainEvents, snapshot, step, TICK_RATE, towerId, unitLoadout, type World } from "./index.js";
import { cast, cmd, kit, run, VANILLA, VANILLA_MELEE } from "./test-helpers.js";

const minions = (world: World, side?: 0 | 1) => [...world.dots.values()].filter((d) => d.kind === "minion" && (side === undefined || d.side === side));

/** A lane world with no waves of its own, for placing minions by hand. */
function quietLane() {
  const world = createWorld(seedV1, { lane: true });
  world.nextWaveIn = Infinity;
  return world;
}

let n = 0;
const minion = (world: World, side: 0 | 1, x: number, range: "melee" | "ranged" = "melee", y = 300) =>
  addDot(world, { id: `test-m${++n}`, kind: "minion", side, loadout: unitLoadout(range), pos: { x, y } });

function watch(world: World, seconds: number): GameEvent[] {
  const out: GameEvent[] = drainEvents(world);
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
    step(world);
    out.push(...drainEvents(world));
  }
  return out;
}

describe("minion waves", () => {
  it("come first at 5 s, then every 20 s: 2 melee and 2 ranged a side", () => {
    const world = createWorld(seedV1, { lane: true });
    run(world, 4.9);
    expect(minions(world)).toHaveLength(0);
    run(world, 0.2);
    for (const side of [0, 1] as const) {
      const wave = minions(world, side);
      expect(wave.filter((m) => m.loadout.range === "melee")).toHaveLength(2);
      expect(wave.filter((m) => m.loadout.range === "ranged")).toHaveLength(2);
      expect(wave[0]).toMatchObject({ stats: { maxHealth: 300 } });
    }
    expect(minions(world, 0).find((m) => m.loadout.range === "melee")!.stats).toMatchObject({ maxHealth: 300, attack: 25, range: 100 });
    expect(minions(world, 0).find((m) => m.loadout.range === "ranged")!.stats).toMatchObject({ maxHealth: 200, attack: 35, range: 400 });
    run(world, 19.8);
    const firstIds = new Set(minions(world).map((m) => m.id));
    run(world, 0.2);
    expect(minions(world).filter((m) => !firstIds.has(m.id))).toHaveLength(8);
  });

  it("march on the other base, slower than dots, and fight the other wave where they meet", () => {
    const world = createWorld(seedV1, { lane: true });
    run(world, 5.1);
    const melee = minions(world, 0).find((m) => m.loadout.range === "melee")!;
    const x0 = melee.pos.x;
    run(world, 1);
    expect(melee.pos.x - x0).toBeCloseTo(240, -1);
    run(world, 6);
    expect(minions(world).some((m) => m.health < m.stats.maxHealth)).toBe(true);
    for (const m of minions(world)) expect(m.pos.x).toBeGreaterThan(900), expect(m.pos.x).toBeLessThan(2100);
  });
});

describe("Minions follow standard MOBA rules: they fight other minions, and switch to you if you attack an enemy player.", () => {
  it("fight an enemy minion before a dot standing closer", () => {
    const world = quietLane();
    minion(world, 0, 1500);
    const enemy = minion(world, 1, 1580);
    const dot = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1540, y: 340 } });
    run(world, 2);
    expect(dot.health).toBe(dot.stats.maxHealth);
    expect(enemy.health).toBeLessThan(enemy.stats.maxHealth);
  });

  it("attack a dot when nothing else is near", () => {
    const world = quietLane();
    minion(world, 1, 1580);
    const dot = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1500, y: 300 } });
    run(world, 2);
    expect(dot.health).toBeLessThan(dot.stats.maxHealth);
  });

  it("switch to a dot that attacks one of their side's dots, and go back to minions once it stops", () => {
    const world = quietLane();
    const ours = minion(world, 0, 1500);
    const theirs = minion(world, 1, 1580);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1700, y: 300 } });
    run(world, 0.5);
    expect(theirs.attackTarget).toBe(ours.id);

    applyCommand(world, "a", cmd.attack("b"));
    run(world, 1.2); // one auto lands
    expect(theirs.attackTarget).toBe("a");

    applyCommand(world, "a", cmd.stop());
    run(world, seedV1.minions.aggroDuration + 0.2);
    expect(theirs.attackTarget).toBe(ours.id);
    expect(a.health).toBeLessThan(a.stats.maxHealth);
  });

  it("ignore a dot that only attacks minions", () => {
    const world = quietLane();
    const ours = minion(world, 0, 1500);
    const theirs = minion(world, 1, 1580);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    applyCommand(world, "a", cmd.attack(theirs.id));
    run(world, 2);
    expect(theirs.attackTarget).toBe(ours.id);
    expect(a.health).toBe(a.stats.maxHealth);
  });

  it("take spells like any unit, and stand in the way of skillshots", () => {
    const world = quietLane();
    const shield = minion(world, 1, 1400, "melee", 300);
    const dot = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1600, y: 300 } });
    addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 1100, y: 300 } });
    applyCommand(world, "a", cast("Q", 1600, 300));
    run(world, 1);
    expect(shield.health).toBeLessThan(shield.stats.maxHealth);
    expect(dot.health).toBe(dot.stats.maxHealth);
  });

  it("don't set off traps", () => {
    const world = quietLane();
    addDot(world, { id: "a", side: 0, loadout: kit({ W: "trap" }), pos: { x: 1300, y: 300 } });
    applyCommand(world, "a", cast("W", 1500, 300));
    run(world, 0.5);
    const m = minion(world, 1, 1500);
    run(world, 0.2);
    expect(world.spells.some((s) => s.kind === "trap")).toBe(true);
    expect(m.statuses).toEqual([]);
  });
});

describe("Towers target minions first and switch to an enemy player who attacks a player.", () => {
  const tower = (world: World, side: 0 | 1) => world.dots.get(towerId(side))!;

  it("stand where the map puts them, and never move", () => {
    const world = createWorld(seedV1, { lane: true });
    run(world, 30);
    expect(tower(world, 0).pos).toEqual(world.geometry.towers[0]);
    expect(tower(world, 1).pos).toEqual(world.geometry.towers[1]);
  });

  it("shoot a minion before a dot", () => {
    const world = quietLane();
    const m = minion(world, 0, 1950, "ranged");
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1900, y: 380 } });
    run(world, 1.5);
    expect(m.health).toBeLessThan(m.stats.maxHealth);
    expect(a.health).toBe(a.stats.maxHealth);
  });

  it("switch to a dot in range that attacks one of their dots", () => {
    const world = quietLane();
    const m = minion(world, 0, 1950, "ranged");
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 1900, y: 380 } });
    addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 2000, y: 380 } });
    run(world, 0.2);
    expect(tower(world, 1).attackTarget).toBe(m.id);
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 0.5);
    expect(tower(world, 1).attackTarget).toBe("a");
  });

  it("fire homing shots that hit 25% harder for each hit in a row on the same dot", () => {
    const world = quietLane();
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1950, y: 300 } });
    applyCommand(world, "a", cmd.move(1850, 200)); // walking off doesn't dodge a homing shot
    const hits = watch(world, 3.2).filter((e) => e.kind === "hit" && e.source === towerId(1) && e.target === "a");
    expect(hits.map((e) => (e.kind === "hit" ? e.amount : 0))).toEqual([150, 187.5, 225]);
    expect(a.health).toBe(1000 - 150 - 187.5 - 225);
  });

  it("start the ramp over on a new target", () => {
    const world = quietLane();
    minion(world, 0, 1950, "ranged");
    addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1950, y: 400 } });
    const shots = watch(world, 3.2).filter((e) => e.kind === "hit" && e.source === towerId(1));
    // The minion first: 150 and 187.5 kill it (200 health). Then on to a, starting from 150 again.
    expect(shots.map((e) => (e.kind === "hit" ? [e.target === "a" ? "a" : "minion", e.amount] : []))).toEqual([
      ["minion", 150],
      ["minion", 187.5],
      ["a", 150],
    ]);
  });

  it("take autos but not spells", () => {
    const world = quietLane();
    addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt", W: "chill-field" }), pos: { x: 1700, y: 300 } });
    const t = tower(world, 1);
    applyCommand(world, "a", cast("Q", t.pos.x, t.pos.y));
    run(world, 1);
    applyCommand(world, "a", cast("W", t.pos.x, t.pos.y));
    run(world, 1);
    expect(t.health).toBe(t.stats.maxHealth);
    applyCommand(world, "a", cmd.attack(t.id));
    run(world, 1.8);
    expect(t.health).toBe(t.stats.maxHealth - 100);
  });

  it("stay down once destroyed, until the next match", () => {
    const world = quietLane();
    const t = tower(world, 1);
    t.health = 50;
    addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1750, y: 300 } });
    applyCommand(world, "a", cmd.attack(t.id));
    run(world, 1.5);
    expect(t.alive).toBe(false);
    run(world, 30);
    expect(t.alive).toBe(false);
    expect(world.dots.has(t.id)).toBe(true);
  });
});

describe("snapshots", () => {
  it("carry minions and towers with their kind and size", () => {
    const world = createWorld(seedV1, { lane: true });
    addDot(world, { id: "a", side: 0, loadout: VANILLA });
    run(world, 5.1);
    const snap = snapshot(world, { side: 0, dotId: "a" }, 0);
    expect(snap.dots.filter((d) => d.kind === "tower").map((d) => d.radius)).toEqual([50, 50]);
    expect(snap.dots.filter((d) => d.kind === "minion")).toHaveLength(8);
    expect(snap.dots.find((d) => d.id === "a")).toMatchObject({ kind: "dot", radius: 30, level: 1 });
    expect(snap.self).toMatchObject({ level: 1, xp: 0, items: [] });
    expect(snap.self!.gold).toBeCloseTo(5.1, 1);
  });
});
