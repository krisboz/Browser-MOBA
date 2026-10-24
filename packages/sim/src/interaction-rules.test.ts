// Scenario tests for "Interaction rules" in docs/design-notes.md, one describe per rule, quoted as written.
// A failing scenario is fixed in a block, never in an ability.
import { describe, expect, it } from "vitest";
import { parseBalance, seedV1 } from "@moba/balance";
import { addDot, applyCommand, createWorld, damageDot, step } from "./index.js";
import { cast, cmd, inflict, kit, near, run, VANILLA, VANILLA_MELEE } from "./test-helpers.js";

const R = seedV1.dot.radius;
const windUp = (attacksPerSecond = 1) => seedV1.dot.autoWindUpShare / attacksPerSecond;
const hook = seedV1.abilities.find((a) => a.id === "reel")!.blocks[0] as { speed: number; retractSpeed: number };

describe("Ranged autos home in on their target with no physics. Melee autos have no projectile; the hit lands at release.", () => {
  it("a ranged auto follows a target that walks away, and passes over walls", () => {
    const world = createWorld(seedV1);
    // Shooter and target on either side of the top outcrop: the shot flies over the wall.
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1100, y: 60 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1350, y: 60 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 1, () => world.projectiles.length > 0);
    expect(world.projectiles).toHaveLength(1);
    applyCommand(world, "b", cmd.move(1350, 400));
    run(world, 1, () => world.projectiles.length === 0);
    expect(b.health).toBe(b.stats.maxHealth - a.stats.attack);
  });

  it("a melee auto lands on the tick it is released, with no projectile", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 500, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 600, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    const t = run(world, 1, () => b.health < b.stats.maxHealth);
    expect(world.projectiles).toHaveLength(0);
    expect(t).toBeCloseTo(windUp(), 1);
  });
});

describe("An auto always lands once released, even if the attacker dies or moves, or the target turns invisible. Cancelling before release means nothing fires.", () => {
  function shotInFlight() {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1000, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: kit({ W: "vanish" }), pos: { x: 1440, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 1, () => world.projectiles.length > 0);
    expect(world.projectiles).toHaveLength(1);
    return { world, a, b };
  }

  it("lands after the attacker dies", () => {
    const { world, a, b } = shotInFlight();
    damageDot(world, "b", 1, a, 1e6, "physical", null);
    expect(a.alive).toBe(false);
    run(world, 1, () => world.projectiles.length === 0);
    expect(b.health).toBe(b.stats.maxHealth - a.stats.attack);
  });

  it("lands after the attacker walks away", () => {
    const { world, a, b } = shotInFlight();
    applyCommand(world, "a", cmd.move(400, 300));
    run(world, 1, () => world.projectiles.length === 0);
    expect(b.health).toBe(b.stats.maxHealth - a.stats.attack);
  });

  it("lands after the target turns invisible", () => {
    const { world, a, b } = shotInFlight();
    applyCommand(world, "b", cast("W", b.pos.x, b.pos.y)); // Vanish
    step(world);
    expect(a.attackTarget).toBeNull(); // out of sight: the order lapses...
    run(world, 1, () => world.projectiles.length === 0);
    expect(b.health).toBe(b.stats.maxHealth - a.stats.attack); // ...but the released shot lands
  });

  it("lands after the target hides in brush", () => {
    const { world, a, b } = shotInFlight();
    b.pos = { x: 1500, y: 80 };
    run(world, 1, () => world.projectiles.length === 0);
    expect(b.health).toBe(b.stats.maxHealth - a.stats.attack);
  });

  it("fires nothing when cancelled before release, and refunds the attack", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 500, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 600, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, windUp() / 2);
    expect(a.windUp).not.toBeNull();
    applyCommand(world, "a", cmd.stop());
    run(world, 2);
    expect(b.health).toBe(b.stats.maxHealth);
    expect(a.attackReadyIn).toBe(0);
    applyCommand(world, "a", cmd.attack("b"));
    expect(run(world, 1, () => b.health < b.stats.maxHealth)).toBeCloseTo(windUp(), 1);
  });

  it("a spell still winding up is cancelled the same way: nothing fires, no cooldown", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 1000, y: 300 } });
    applyCommand(world, "a", cast("Q", 1400, 300));
    run(world, 0.1);
    applyCommand(world, "a", cmd.move(900, 300));
    run(world, 1);
    expect(world.spells).toHaveLength(0);
    expect(a.cooldowns.Q).toBe(0);
  });
});

describe("Skillshot spells fly in a straight line at a fixed speed and hit the first thing in their path. Aimed spells can miss; autos cannot.", () => {
  it("hits the first enemy in line, not the one behind, after distance / speed", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 900, y: 300 } });
    const front = addDot(world, { id: "front", side: 1, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    const back = addDot(world, { id: "back", side: 1, loadout: VANILLA, pos: { x: 1500, y: 300 } });
    applyCommand(world, "a", cast("Q", 1500, 300));
    const t = run(world, 2, () => front.health < front.stats.maxHealth);
    // 0.25 s wind-up, then 400 - 30 - 15 units at 1400 units/s.
    expect(t).toBeCloseTo(0.25 + (400 - R - 15) / 1400, 1);
    run(world, 1);
    expect(back.health).toBe(back.stats.maxHealth);
  });

  it("misses a target that steps out of the line", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 900, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1600, y: 300 } });
    applyCommand(world, "a", cast("Q", 1600, 300));
    applyCommand(world, "b", cmd.move(1600, 420));
    run(world, 2);
    expect(b.health).toBe(b.stats.maxHealth);
    expect(world.spells).toHaveLength(0);
  });
});

describe("Being pushed or pulled does not stop you acting.", () => {
  it("a dot being pulled can cast and keep auto attacking", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "thrower", side: 0, loadout: kit({ E: "reel" }), pos: { x: 900, y: 300 } });
    const victim = addDot(world, { id: "victim", side: 1, loadout: kit({ Q: "bolt" }), pos: { x: 1600, y: 300 } });
    applyCommand(world, "thrower", cast("E", 1600, 300));
    run(world, 2, () => victim.motion?.kind === "pull");
    applyCommand(world, "victim", cast("Q", 900, 300));
    run(world, 0.3);
    expect(victim.motion?.kind).toBe("pull");
    expect(victim.cooldowns.Q).toBeGreaterThan(0);
    expect(world.spells.some((s) => s.kind === "shot")).toBe(true);
  });

  it("a dot being knocked back keeps winding up its auto", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: VANILLA, pos: { x: 1000, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    step(world);
    inflict(world, a, [{ kind: "knockback", distance: 200, speed: 600 }], { side: 1, at: { x: 1100, y: 300 } });
    run(world, 1, () => b.health < b.stats.maxHealth);
    expect(b.health).toBeLessThan(b.stats.maxHealth);
  });
});

describe("A stun stops everything.", () => {
  it("no walking, attacking or casting; wind-ups and channels are cancelled", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, level: seedV1.levels.ultimateUnlockLevel, loadout: kit({ Q: "bolt", R: "artillery" }, ["flash", null]), pos: { x: 1000, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1300, y: 300 } });

    applyCommand(world, "a", cast("R", 1300, 300)); // Artillery: channel
    run(world, 0.3);
    expect(a.channel).not.toBeNull();
    inflict(world, a, [{ kind: "stun", duration: 1 }], { side: 1 });
    expect(a.channel).toBeNull();

    const at = { ...a.pos };
    applyCommand(world, "a", cmd.move(500, 300));
    applyCommand(world, "a", cast("Q", 1300, 300));
    applyCommand(world, "a", cast("D", 600, 300));
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 0.9);
    expect(a.pos).toEqual(at);
    expect(a.cooldowns.Q).toBe(0);
    expect(a.cooldowns.D).toBe(0);
    expect(a.windUp).toBeNull();
    // Once it wears off, the attack order it was given goes ahead.
    run(world, 1);
    expect(b.health).toBeLessThan(b.stats.maxHealth);
  });

  it("cancels a spell winding up: nothing fires, no cooldown", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 1000, y: 300 } });
    applyCommand(world, "a", cast("Q", 1400, 300));
    run(world, 0.1);
    inflict(world, a, [{ kind: "stun", duration: 0.5 }], { side: 1 });
    run(world, 1);
    expect(world.spells).toHaveLength(0);
    expect(a.cooldowns.Q).toBe(0);
  });
});

describe("A root stops walking, Dash, Leap and Flash. Attacks and other abilities still work.", () => {
  function rooted() {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ Q: "bolt", E: "dash" }, ["flash", null]), pos: { x: 1000, y: 300 } });
    const leaper = addDot(world, { id: "l", side: 0, loadout: kit({ E: "leap" }, [null, null], "melee"), pos: { x: 1000, y: 400 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1300, y: 300 } });
    for (const d of [a, leaper]) inflict(world, d, [{ kind: "root", duration: 2 }], { side: 1 });
    return { world, a, leaper, b };
  }

  it("blocks walking, Dash, Leap and Flash", () => {
    const { world, a, leaper } = rooted();
    const at = { ...a.pos };
    applyCommand(world, "a", cmd.move(700, 300));
    run(world, 0.3);
    applyCommand(world, "a", cast("E", 1300, 300));
    applyCommand(world, "a", cast("D", 1300, 300));
    applyCommand(world, "l", cast("E", 1300, 400));
    run(world, 0.5);
    expect(a.pos).toEqual(at);
    expect(leaper.pos).toEqual({ x: 1000, y: 400 });
    expect([a.cooldowns.E, a.cooldowns.D, leaper.cooldowns.E]).toEqual([0, 0, 0]);
  });

  it("lets autos and other abilities through", () => {
    const { world, a, b } = rooted();
    applyCommand(world, "a", cast("Q", 1300, 300));
    run(world, 0.6);
    expect(b.health).toBeLessThan(b.stats.maxHealth);
    const afterBolt = b.health;
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 1);
    expect(b.health).toBeLessThan(afterBolt);
  });

  it("stops a dash already under way", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ E: "dash" }), pos: { x: 1000, y: 300 } });
    applyCommand(world, "a", cast("E", 1400, 300));
    step(world);
    const mid = a.pos.x;
    inflict(world, a, [{ kind: "root", duration: 1 }], { side: 1 });
    run(world, 0.5);
    expect(a.pos.x).toBe(mid);
  });

  it("is lifted by Cleanse, which needs no movement", () => {
    const { world, a } = rooted();
    a.loadout.summoners = ["cleanse", "flash"];
    applyCommand(world, "a", cast("D", a.pos.x, a.pos.y));
    applyCommand(world, "a", cast("F", 1300, 300));
    step(world);
    expect(a.pos.x).toBeGreaterThan(1200);
  });
});

describe("The newest forced movement wins and cancels any movement in progress.", () => {
  it("a knockback during a dash ends the dash", () => {
    const world = createWorld(seedV1);
    const a = addDot(world, { id: "a", side: 0, loadout: kit({ E: "dash" }), pos: { x: 1000, y: 300 } });
    applyCommand(world, "a", cast("E", 1400, 300)); // dash right, 300 units
    step(world);
    inflict(world, a, [{ kind: "knockback", distance: 200, speed: 1500 }], { side: 1, at: { x: a.pos.x, y: a.pos.y - 10 } });
    const from = { ...a.pos };
    run(world, 1);
    // Pushed straight down from where it was, not carried on to the right.
    expect(a.pos.x).toBeCloseTo(from.x, 6);
    expect(a.pos.y).toBeCloseTo(from.y + 200, 6);
  });

  it("a knockback during a pull ends the pull, and the hook comes back empty", () => {
    const world = createWorld(seedV1);
    const thrower = addDot(world, { id: "t", side: 0, loadout: kit({ E: "reel" }), pos: { x: 900, y: 300 } });
    const victim = addDot(world, { id: "v", side: 1, loadout: VANILLA, pos: { x: 1600, y: 300 } });
    applyCommand(world, "t", cast("E", 1600, 300));
    run(world, 2, () => victim.motion?.kind === "pull");
    run(world, 0.1);
    inflict(world, victim, [{ kind: "knockback", distance: 150, speed: 1500 }], { side: 0, at: { x: victim.pos.x - 10, y: victim.pos.y } });
    expect(victim.motion?.kind).toBe("knockback");
    const pushedFrom = victim.pos.x;
    run(world, 2);
    expect(victim.pos.x).toBeCloseTo(pushedFrom + 150, 6);
    expect(thrower.anchoredBy).toBeNull();
  });

  it("a dash during a pull ends the pull: the victim acted, and the dash is newer", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "t", side: 0, loadout: kit({ E: "reel" }), pos: { x: 900, y: 300 } });
    const victim = addDot(world, { id: "v", side: 1, loadout: kit({ E: "dash" }), pos: { x: 1600, y: 300 } });
    applyCommand(world, "t", cast("E", 1600, 300));
    run(world, 2, () => victim.motion?.kind === "pull");
    applyCommand(world, "v", cast("E", victim.pos.x, 100));
    expect(victim.motion?.kind).toBe("dash");
    run(world, 1);
    expect(victim.pos.y).toBeLessThan(150);
  });
});

describe("A pull drags the target to wherever the thrower is now.", () => {
  it("follows a thrower who gets knocked aside while pulling", () => {
    const world = createWorld(seedV1);
    const thrower = addDot(world, { id: "t", side: 0, loadout: kit({ E: "reel" }), pos: { x: 1000, y: 300 } });
    const victim = addDot(world, { id: "v", side: 1, loadout: VANILLA, pos: { x: 1700, y: 300 } });
    applyCommand(world, "t", cast("E", 1700, 300));
    run(world, 2, () => victim.motion?.kind === "pull");
    inflict(world, thrower, [{ kind: "knockback", distance: 180, speed: 3000 }], { side: 1, at: { x: 1000, y: 310 } });
    run(world, 2, () => victim.motion === null);
    expect(near(victim.pos, thrower.pos)).toBeCloseTo(2 * R, 3);
    expect(thrower.pos.y).toBeLessThan(150);
  });
});

describe("A thrown hook is independent of its thrower. It keeps flying even if the thrower is dragged away.", () => {
  it("flies on along its line after the thrower is knocked back", () => {
    const world = createWorld(seedV1);
    const thrower = addDot(world, { id: "t", side: 0, loadout: kit({ E: "reel" }), pos: { x: 1000, y: 300 } });
    applyCommand(world, "t", cast("E", 1800, 300));
    run(world, 0.25 + 1 / 30, () => world.spells.length > 0);
    const h = world.spells[0]!;
    const start = { ...h.pos };
    inflict(world, thrower, [{ kind: "knockback", distance: 200, speed: 3000 }], { side: 1, at: { x: 1000, y: 290 } });
    run(world, 0.3);
    expect(h.pos.y).toBeCloseTo(300, 6);
    expect(h.pos.x).toBeCloseTo(start.x + hook.speed * 0.3, 0);
  });
});

describe("A hook retracts faster than anyone can walk.", () => {
  it("no balance version may set a retract speed at or below the walking cap", () => {
    const slow = structuredClone(seedV1);
    (slow.abilities.find((a) => a.id === "reel")!.blocks[0] as { retractSpeed: number }).retractSpeed = slow.dot.moveSpeedCap;
    const result = parseBalance(slow);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toMatch(/not faster than the 450 walking cap/);
  });

  it("an empty hook catches up with a thrower walking away at the cap", () => {
    expect(hook.retractSpeed).toBeGreaterThan(seedV1.dot.moveSpeedCap);
  });
});

describe("The thrower is anchored until the hook is back: no walking, but Flash is allowed and drags the victim to the new spot. An anchored dot can still be pushed or pulled.", () => {
  function hooked() {
    const world = createWorld(seedV1);
    const thrower = addDot(world, { id: "t", side: 0, loadout: kit({ E: "reel" }, ["flash", null]), pos: { x: 1000, y: 300 } });
    const victim = addDot(world, { id: "v", side: 1, loadout: VANILLA, pos: { x: 1600, y: 300 } });
    applyCommand(world, "t", cast("E", 1600, 300));
    run(world, 2, () => victim.motion?.kind === "pull");
    return { world, thrower, victim };
  }

  it("can't walk while the hook is out", () => {
    const { world, thrower } = hooked();
    applyCommand(world, "t", cmd.move(500, 300));
    run(world, 0.1);
    expect(thrower.pos).toEqual({ x: 1000, y: 300 });
  });

  it("Flash is allowed, and the victim is dragged to the new spot", () => {
    const { world, thrower, victim } = hooked();
    applyCommand(world, "t", cast("D", 1000, 100));
    expect(thrower.pos).toEqual({ x: 1000, y: 100 });
    run(world, 2, () => victim.motion === null);
    expect(near(victim.pos, thrower.pos)).toBeCloseTo(2 * R, 3);
  });

  it("an anchored dot can still be pushed", () => {
    const { world, thrower } = hooked();
    inflict(world, thrower, [{ kind: "knockback", distance: 100, speed: 1500 }], { side: 1, at: { x: 1010, y: 300 } });
    run(world, 0.2);
    expect(thrower.pos.x).toBeCloseTo(900, 6);
  });

  it("the walk goes ahead once the hook is back", () => {
    const { world, thrower, victim } = hooked();
    applyCommand(world, "t", cmd.move(500, 300));
    run(world, 2, () => victim.motion === null);
    run(world, 0.1);
    expect(thrower.pos.x).toBeLessThan(1000);
  });

  it("A hooks an enemy, then B hooks A: the last hooker pulls both", () => {
    // At the seed numbers the enemy reaches A before B's hook lands; a slower retract (still beating the
    // walking cap) leaves time for B's hook to land while A's victim is still on the way.
    const slow = structuredClone(seedV1);
    (slow.abilities.find((x) => x.id === "reel")!.blocks[0] as { retractSpeed: number }).retractSpeed = 600;
    const world = createWorld(slow);
    const b = addDot(world, { id: "B", side: 1, loadout: kit({ E: "reel" }), pos: { x: 850, y: 300 } });
    const a = addDot(world, { id: "A", side: 0, loadout: kit({ E: "reel" }), pos: { x: 1200, y: 300 } });
    const e = addDot(world, { id: "E", side: 1, loadout: VANILLA, pos: { x: 1650, y: 300 } });
    applyCommand(world, "A", cast("E", 1650, 300));
    run(world, 2, () => e.motion?.kind === "pull");
    applyCommand(world, "B", cast("E", 1200, 300));
    run(world, 2, () => a.motion?.kind === "pull");
    expect(e.motion?.kind).toBe("pull"); // both in tow at once
    run(world, 3, () => !e.motion && !a.motion);
    expect(near(a.pos, b.pos)).toBeCloseTo(2 * R, 3);
    expect(near(e.pos, a.pos)).toBeCloseTo(2 * R, 3);
    expect(e.pos.x).toBeLessThan(1000);
  });
});

describe("Assumed: Dash and Leap are blocked while anchored.", () => {
  it("refuses Dash and Leap with the hook out", () => {
    const world = createWorld(seedV1);
    const t = addDot(world, { id: "t", side: 0, loadout: kit({ E: "reel", Q: "dash", W: "leap" }), pos: { x: 1000, y: 300 } });
    // Dash and Leap normally sit on E; slotted elsewhere here so one dot can hold all three.
    t.loadout.abilities = { Q: "dash", W: "leap", E: "reel", R: null };
    addDot(world, { id: "v", side: 1, loadout: VANILLA, pos: { x: 1600, y: 300 } });
    applyCommand(world, "t", cast("E", 1600, 300));
    run(world, 0.3);
    expect(t.anchoredBy).not.toBeNull();
    applyCommand(world, "t", cast("Q", 1000, 100));
    applyCommand(world, "t", cast("W", 1000, 100));
    run(world, 0.2);
    expect(t.pos).toEqual({ x: 1000, y: 300 });
    expect([t.cooldowns.Q, t.cooldowns.W]).toEqual([0, 0]);
  });
});

describe("Dome: enemy spells cast from outside are blocked and autos are not. A spell cast from inside still lands, even if its caster has since been pushed out.", () => {
  // Bolt with no wind-up, so a caster can cast on the exact tick it stands inside the dome.
  const instantBolt = structuredClone(seedV1);
  instantBolt.abilities.find((a) => a.id === "bolt")!.windUp = 0;

  function domed(balance = seedV1) {
    const world = createWorld(balance);
    const tank = addDot(world, { id: "tank", side: 1, level: seedV1.levels.ultimateUnlockLevel, loadout: kit({ R: "dome" }, [null, null], "melee"), pos: { x: 1300, y: 300 } });
    applyCommand(world, "tank", cast("R", 1300, 300));
    run(world, 0.8); // wind-up, then fully expanded
    expect(world.spells.some((s) => s.kind === "zone")).toBe(true);
    return { world, tank };
  }

  it("blocks a Bolt cast from outside", () => {
    const { world, tank } = domed();
    addDot(world, { id: "p", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 850, y: 300 } });
    applyCommand(world, "p", cast("Q", 1300, 300));
    run(world, 1);
    expect(tank.health).toBe(tank.stats.maxHealth);
  });

  it("blocks an area cast from outside onto a dot inside", () => {
    const { world, tank } = domed();
    addDot(world, { id: "p", side: 0, loadout: kit({ W: "chill-field" }), pos: { x: 750, y: 300 } });
    applyCommand(world, "p", cast("W", 1300, 300));
    run(world, 1);
    expect(tank.health).toBe(tank.stats.maxHealth);
    expect(tank.statuses.some((s) => s.kind === "slow")).toBe(false);
  });

  it("lets autos from outside through", () => {
    const { world, tank } = domed();
    addDot(world, { id: "p", side: 0, loadout: VANILLA, pos: { x: 850, y: 300 } });
    applyCommand(world, "p", cmd.attack("tank"));
    run(world, 1.5);
    expect(tank.health).toBeLessThan(tank.stats.maxHealth);
  });

  it("pushes enemies out", () => {
    const { world } = domed();
    const p = addDot(world, { id: "p", side: 0, loadout: VANILLA, pos: { x: 1350, y: 300 } });
    step(world);
    expect(near(p.pos, { x: 1300, y: 300 })).toBeCloseTo(350 + R, 3);
  });

  it("a spell cast from inside lands, though its caster is pushed out right after", () => {
    const { world, tank } = domed(instantBolt);
    const p = addDot(world, { id: "p", side: 0, loadout: kit({ Q: "bolt" }), pos: { x: 1450, y: 300 } });
    applyCommand(world, "p", cast("Q", 1300, 300));
    step(world);
    expect(near(p.pos, tank.pos)).toBeGreaterThan(350); // pushed out
    run(world, 0.5);
    expect(tank.health).toBeLessThan(tank.stats.maxHealth);
  });
});
