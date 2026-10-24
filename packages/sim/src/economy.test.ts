import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import type { GameEvent } from "@moba/protocol";
import {
  addDot,
  applyCommand,
  createWorld,
  damageDot,
  drainEvents,
  effectiveStats,
  loadoutFor,
  resetMatch,
  step,
  TICK_RATE,
  towerId,
  unitLoadout,
  type World,
} from "./index.js";
import { cast, cmd, farm, kit, run, VANILLA } from "./test-helpers.js";

const buy = (item: string) => ({ type: "buy" as const, seq: 0, tick: 0, item });

function quietLane() {
  const world = createWorld(seedV1, { lane: true });
  world.nextWaveIn = Infinity;
  return world;
}

const goldEvents = (events: GameEvent[], target: string) => events.filter((e) => e.kind === "gold" && e.target === target);

describe("gold", () => {
  it("15 per last hit, with 10 experience; a minion killed by a tower or minion pays nobody", () => {
    const world = quietLane();
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    const m = addDot(world, { id: "m", kind: "minion", side: 1, loadout: unitLoadout("melee"), pos: { x: 1500, y: 300 } });
    m.health = 50;
    applyCommand(world, "a", cmd.attack("m"));
    run(world, 1);
    expect(m.alive).toBe(false);
    expect(world.dots.has("m")).toBe(false); // dead minions leave the world
    expect(goldEvents(drainEvents(world), "a").map((e) => (e.kind === "gold" ? e.amount : 0))).toEqual([15]);
    expect(a.xp).toBe(10);

    const other = addDot(world, { id: "m2", kind: "minion", side: 1, loadout: unitLoadout("melee"), pos: { x: 1500, y: 300 } });
    damageDot(world, towerId(0), 0, other, 1000, "physical", null);
    damageDot(world, "some-minion", 0, other, 1000, "physical", null);
    expect(goldEvents(drainEvents(world), "a")).toEqual([]);
    expect(a.xp).toBe(10);
  });

  it("trickles in at 1 per second for everyone, dead or alive", () => {
    const world = quietLane();
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 100, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 2900, y: 300 } });
    damageDot(world, towerId(0), 0, b, 5000, "physical", null);
    run(world, 4);
    expect(a.gold).toBeCloseTo(4, 6);
    expect(b.alive).toBe(false);
    expect(b.gold).toBeCloseTo(4, 6);
  });

  it("150 per kill, times 1 + 0.2 for each death the killer has beyond their kills", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1500, y: 300 } });
    damageDot(world, "a", 0, b, 5000, "physical", null);
    expect(a.gold).toBe(150);
    expect(a.xp).toBe(100);

    a.deaths = 2;
    run(world, 6.1);
    damageDot(world, "a", 0, b, 5000, "physical", null);
    // Now 1 kill and 2 deaths: one death behind.
    expect(a.gold).toBeCloseTo(150 + 150 * 1.2, 9);
    expect(a.killTimes).toHaveLength(2);
  });

  it("a destroyed tower pays 200 and 100 experience to every dot on the side that brought it down", () => {
    const world = quietLane();
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 2900, y: 300 } });
    const tower = world.dots.get(towerId(1))!;
    damageDot(world, "some-minion", 0, tower, 5000, "physical", null);
    expect(tower.alive).toBe(false);
    expect(a.gold).toBe(200);
    expect(a.xp).toBe(100);
    expect(b.gold).toBe(0);
    expect(world.score).toEqual([0, 0]); // only a dot's death scores
  });
});

describe("levels", () => {
  it("100 experience a level, up to 10", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    const m = () => addDot(world, { id: `m${Math.random()}`, kind: "minion", side: 1, loadout: unitLoadout("melee"), pos: { x: 1500, y: 300 } });
    for (let i = 0; i < 9; i++) damageDot(world, "a", 0, m(), 1000, "physical", null);
    expect(a.level).toBe(1);
    damageDot(world, "a", 0, m(), 1000, "physical", null);
    expect(a.level).toBe(2);
    expect(drainEvents(world).filter((e) => e.kind === "level")).toMatchObject([{ target: "a", level: 2 }]);
    for (let i = 0; i < 200; i++) damageDot(world, "a", 0, m(), 1000, "physical", null);
    expect(a.level).toBe(10);
  });

  it("each level past the first cuts ability cooldowns by 4%; summoners keep theirs", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ W: "frenzy" }, ["heal", null]), pos: { x: 1300, y: 300 }, level: 6 });
    applyCommand(world, "a", cast("W", 0, 0));
    applyCommand(world, "a", cast("D", 0, 0));
    expect(a.cooldowns.W).toBeCloseTo(12 * (1 - 0.04 * 5), 9);
    expect(a.cooldowns.D).toBe(120);
  });

  it("R unlocks at level 3", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ R: "overdrive" }), pos: { x: 1300, y: 300 }, level: 2 });
    applyCommand(world, "a", cast("R", 0, 0));
    expect(a.cooldowns.R).toBe(0);
    a.xp = 200;
    damageDot(world, "a", 0, addDot(world, { id: "m", kind: "minion", side: 1, loadout: unitLoadout("melee"), pos: { x: 1500, y: 300 } }), 1000, "physical", null);
    expect(a.level).toBe(3);
    applyCommand(world, "a", cast("R", 0, 0));
    expect(a.cooldowns.R).toBeGreaterThan(0);
  });
});

describe("the shop", () => {
  it("sells in your own base, adding the item's stats", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA });
    a.gold = 1500;
    applyCommand(world, "a", buy("blade"));
    applyCommand(world, "a", buy("heart"));
    applyCommand(world, "a", buy("boots"));
    expect(a.gold).toBe(1500 - 400 - 400 - 250);
    expect(a.items.map((i) => i.id)).toEqual(["blade", "heart", "boots"]);
    expect(a.stats).toMatchObject({ attack: 125, maxHealth: 1300 });
    // Bought health comes full.
    expect(a.health).toBe(1300);
    expect(effectiveStats(world, a).moveSpeed).toBeCloseTo(345, 9);
  });

  it("adds item and buff movement speed together, under the cap", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({}, ["sprint", null]) });
    a.gold = 250;
    applyCommand(world, "a", buy("boots"));
    applyCommand(world, "a", cast("D", 0, 0));
    expect(effectiveStats(world, a).moveSpeed).toBe(450);
  });

  it("refuses outside your base, short of gold, or with every slot full; the dead may buy", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA });
    a.gold = 399;
    applyCommand(world, "a", buy("blade"));
    expect(a.items).toEqual([]);

    a.gold = 10_000;
    a.pos = { x: 1000, y: 300 };
    applyCommand(world, "a", buy("blade"));
    expect(a.items).toEqual([]);

    damageDot(world, "b", 1, a, 5000, "physical", null);
    applyCommand(world, "a", buy("blade"));
    expect(a.items).toHaveLength(1);

    for (let i = 0; i < 10; i++) applyCommand(world, "a", buy("plate"));
    expect(a.items).toHaveLength(seedV1.shop.inventorySlots);
    applyCommand(world, "a", buy("nonsense"));
    expect(a.items).toHaveLength(seedV1.shop.inventorySlots);
  });

  it("first item lands around level 2 or 3 in a normal farming game", () => {
    const world = createWorld(seedV1, { lane: true });
    const me = addDot(world, { id: "me", side: 0, loadout: loadoutFor(seedV1, "marksman")! });
    const cheapest = Math.min(...seedV1.items.map((i) => i.cost));
    const full = Math.max(...seedV1.items.map((i) => i.cost));
    const levelAt: Record<number, number> = {};
    for (let i = 0; i < 240 * TICK_RATE && !levelAt[full]; i++) {
      farm(world, me);
      step(world);
      for (const cost of [cheapest, full]) if (!levelAt[cost] && me.gold >= cost) levelAt[cost] = me.level;
    }
    expect(levelAt[cheapest]).toBeGreaterThanOrEqual(2);
    expect(levelAt[full]).toBeGreaterThanOrEqual(2);
    expect(levelAt[full]).toBeLessThanOrEqual(3);
  });
});

describe("a new match", () => {
  it("resets gold, levels and items, clears minions and stands towers back up", () => {
    const world = createWorld(seedV1, { lane: true });
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA });
    a.gold = 400;
    applyCommand(world, "a", buy("heart"));
    run(world, 6);
    a.xp = 250;
    a.level = 3;
    const tower = world.dots.get(towerId(1))!;
    damageDot(world, "a", 0, tower, 5000, "physical", null);
    expect([...world.dots.values()].some((d) => d.kind === "minion")).toBe(true);

    resetMatch(world);
    expect(a).toMatchObject({ gold: 0, xp: 0, level: 1, items: [], killTimes: [] });
    expect(a.stats.maxHealth).toBe(1000);
    expect(tower).toMatchObject({ alive: true, health: 2500 });
    expect([...world.dots.values()].some((d) => d.kind === "minion")).toBe(false);
    run(world, 5.1);
    expect([...world.dots.values()].some((d) => d.kind === "minion")).toBe(true);
  });
});

/** A dot that only goes for the dummy: walks up, casts every ability it has at it, and autos it. */
function hunt(world: World, me: string, dummy: string): void {
  const d = world.dots.get(me)!;
  const target = world.dots.get(dummy)!;
  if (!d.alive || !target.alive) return;
  if (d.attackTarget !== dummy) applyCommand(world, me, cmd.attack(dummy));
  if (Math.hypot(d.pos.x - target.pos.x, d.pos.y - target.pos.y) < 500) {
    for (const slot of ["Q", "W", "E", "R"] as const) if (d.cooldowns[slot] === 0) applyCommand(world, me, cast(slot, target.pos.x, target.pos.y));
  }
}

describe("a full match against the dummy", () => {
  it("runs to 5 kills with minions, towers and gold all going", () => {
    const world = createWorld(seedV1, { lane: true });
    addDot(world, { id: "me", side: 0, loadout: loadoutFor(seedV1, "diver")! });
    addDot(world, { id: "dummy", side: 1, loadout: VANILLA, pos: { x: seedV1.dummy.x, y: seedV1.dummy.y }, dummy: true });
    world.dots.get("dummy")!.home = { x: seedV1.dummy.x, y: seedV1.dummy.y };
    let seconds = 0;
    while (world.winner === null && seconds < 600) {
      hunt(world, "me", "dummy");
      step(world);
      seconds += 1 / TICK_RATE;
    }
    expect(world.winner).toBe(0);
    expect(world.score[0]).toBe(5);
    // Minions and towers treat the dummy like any dot, so some of the five are theirs.
    const me = world.dots.get("me")!;
    expect(me.kills).toBeGreaterThan(0);
    expect(me.level).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(600);
  });
});
