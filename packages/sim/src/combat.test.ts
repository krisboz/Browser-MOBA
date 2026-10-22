import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { addDot, applyCommand, computeStats, createWorld, damageDot, loadoutFor, mitigate, pointIssues, resetMatch, setPatrol, snapshot } from "./index.js";
import { cmd, run, VANILLA, VANILLA_MELEE } from "./test-helpers.js";

describe("stats", () => {
  it("adds points to the vanilla base", () => {
    const poke = computeStats(seedV1, loadoutFor(seedV1, "poke")!);
    expect(poke).toMatchObject({ maxHealth: 1250, attack: 100, attackSpeed: 1.25, magicAttack: 100, armor: 0, magicResist: 50, range: 450 });
    const tank = computeStats(seedV1, loadoutFor(seedV1, "tank")!);
    expect(tank).toMatchObject({ maxHealth: 1500, armor: 80, magicResist: 70, range: 150 });
  });

  it("halves damage at 100 resist", () => {
    expect(mitigate(seedV1, 200, 0)).toBe(200);
    expect(mitigate(seedV1, 200, 100)).toBe(100);
  });

  it("checks point spreads against the cap and the budget", () => {
    expect(pointIssues(seedV1, { attack: 10, health: 10, armor: 5 })).toEqual([]);
    expect(pointIssues(seedV1, { attack: 11 })).toHaveLength(1);
    expect(pointIssues(seedV1, { attack: 10, health: 10, armor: 6 })).toHaveLength(1);
  });
});

describe("autos", () => {
  it("two vanilla dots trade autos for about 10 s to a kill", () => {
    for (const loadout of [VANILLA_MELEE, VANILLA]) {
      const world = createWorld(seedV1);
      const a = addDot(world, { id: "a", side: 0, loadout, pos: { x: 1300, y: 300 } });
      const b = addDot(world, { id: "b", side: 1, loadout, pos: { x: 1400, y: 300 } });
      applyCommand(world, "a", cmd.attack("b"));
      applyCommand(world, "b", cmd.attack("a"));
      const seconds = run(world, 20, () => !a.alive || !b.alive);
      expect(seconds).toBeGreaterThan(9);
      expect(seconds).toBeLessThan(10.5);
    }
  });

  it("winds up for 30% of the attack interval, scaling with attack speed", () => {
    const world = createWorld(seedV1);
    const fast = addDot(world, { id: "a", side: 0, loadout: { ...VANILLA_MELEE, points: { attackSpeed: 10 } }, pos: { x: 500, y: 300 } });
    addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 600, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 1 / 30);
    expect(fast.windUp!.duration).toBeCloseTo(0.3 / 1.5, 9);
  });

  it("walks into range before attacking, measuring from its centre to the target's edge", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 500, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1000, y: 120 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 5, () => a.windUp !== null);
    const gap = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) - seedV1.dot.radius;
    expect(gap).toBeLessThanOrEqual(150 + 1e-6);
    expect(gap).toBeGreaterThan(145);
  });

  it("never picks a target by itself", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 500, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 560, y: 300 } });
    run(world, 3);
    expect(b.health).toBe(b.stats.maxHealth);
  });
});

describe("death, respawn and the match", () => {
  it("respawns at home with full health after 6 s", () => {
    const world = createWorld(seedV1);
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA });
    b.pos = { x: 1500, y: 300 };
    damageDot(world, "a", 0, b, 5000, "physical");
    expect(b.alive).toBe(false);
    run(world, 5.9);
    expect(b.alive).toBe(false);
    run(world, 0.2);
    expect(b.alive).toBe(true);
    expect(b.health).toBe(b.stats.maxHealth);
    expect(b.pos).toEqual(world.geometry.spawns[1]);
  });

  it("ends at 5 kills and resets for the next match", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA });
    for (let i = 0; i < 5; i++) {
      damageDot(world, "a", 0, b, 5000, "physical");
      run(world, 6.1);
    }
    expect(world.score).toEqual([5, 0]);
    expect(world.winner).toBe(0);
    expect(a.kills).toBe(5);
    expect(b.deaths).toBe(5);
    resetMatch(world);
    expect(world.score).toEqual([0, 0]);
    expect(world.winner).toBeNull();
    expect(b.alive).toBe(true);
  });

  it("heals in your own base only", () => {
    const world = createWorld(seedV1);
    const home = addDot(world, { id: "a", side: 0, loadout: VANILLA });
    const away = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 150, y: 300 } }); // in the other side's base
    home.health = away.health = 100;
    run(world, 1);
    expect(home.health).toBeCloseTo(100 + 0.2 * 1000, 6);
    expect(away.health).toBe(100);
  });
});

describe("brush reveal", () => {
  it("shows a dot that attacks from brush for 1 s after the release", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "hider", side: 1, loadout: VANILLA_MELEE, pos: { x: 1500, y: 100 } });
    addDot(world, { id: "victim", side: 0, loadout: VANILLA, pos: { x: 1500, y: 220 } });
    const seen = () => snapshot(world, { side: 0, dotId: "victim" }, 0).dots.some((d) => d.id === "hider");
    expect(seen()).toBe(false);
    applyCommand(world, "hider", cmd.attack("victim"));
    run(world, 1, () => world.dots.get("hider")!.lastReleaseTick >= 0);
    applyCommand(world, "hider", cmd.stop());
    run(world, 1 / 30);
    expect(seen()).toBe(true);
    run(world, 1);
    expect(seen()).toBe(false);
  });
});

describe("target dummy", () => {
  it("is an ordinary dot: it takes damage, dies and counts as a kill", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 1400, y: 300 } });
    const dummy = addDot(world, { id: "dummy", side: 1, loadout: VANILLA, pos: { x: 1500, y: 300 }, dummy: true });
    applyCommand(world, "a", cmd.attack("dummy"));
    run(world, 15, () => !dummy.alive);
    expect(dummy.alive).toBe(false);
    expect(world.score).toEqual([1, 0]);
    run(world, 6.1);
    expect(dummy.pos).toEqual({ x: 1500, y: 300 }); // back on its spot, not in the base
  });

  it("walks back and forth across the lane when patrolling", () => {
    const world = createWorld(seedV1);
    const dummy = addDot(world, { id: "dummy", side: 1, loadout: VANILLA, pos: { x: 1500, y: 300 }, dummy: true });
    setPatrol(world, dummy, true);
    const ys: number[] = [];
    for (let i = 0; i < 120; i++) {
      run(world, 1 / 30);
      ys.push(dummy.pos.y);
    }
    expect(Math.min(...ys)).toBeCloseTo(100, 0);
    expect(Math.max(...ys)).toBeCloseTo(500, 0);
    expect(new Set(ys.map((y) => Math.round(y))).size).toBeGreaterThan(30);
  });
});
