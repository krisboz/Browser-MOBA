// Scenario tests for "Interaction rules" in docs/design-notes.md, one describe per rule.
// Each rule gets its test before the abilities that rely on it; M3 adds the spell rules.
import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { addDot, applyCommand, createWorld, damageDot, step } from "./index.js";
import { cmd, run, VANILLA, VANILLA_MELEE } from "./test-helpers.js";

const windUp = (attacksPerSecond = 1) => seedV1.dot.autoWindUpShare / attacksPerSecond;

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
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 1440, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, 1, () => world.projectiles.length > 0);
    expect(world.projectiles).toHaveLength(1);
    return { world, a, b };
  }

  it("lands after the attacker dies", () => {
    const { world, a, b } = shotInFlight();
    damageDot(world, "b", 1, a, 1e6, "physical");
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

  it("lands after the target turns invisible in brush", () => {
    const { world, a, b } = shotInFlight();
    b.pos = { x: 1500, y: 80 }; // into the top brush patch
    step(world);
    expect(world.dots.get("a")!.attackTarget).toBeNull(); // out of sight: the order lapses...
    run(world, 1, () => world.projectiles.length === 0);
    expect(b.health).toBe(b.stats.maxHealth - a.stats.attack); // ...but the released shot lands
  });

  it("fires nothing when cancelled before release, and refunds the attack", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 500, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 600, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, windUp() / 2);
    expect(world.dots.get("a")!.windUp).not.toBeNull();
    applyCommand(world, "a", cmd.stop());
    run(world, 2);
    expect(b.health).toBe(b.stats.maxHealth);
    // The cancel refunded the attack: a new order winds up at once instead of waiting out the interval.
    expect(world.dots.get("a")!.attackReadyIn).toBe(0);
    applyCommand(world, "a", cmd.attack("b"));
    expect(run(world, 1, () => b.health < b.stats.maxHealth)).toBeCloseTo(windUp(), 1);
  });

  it("is cancelled by a move order too", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "a", side: 0, loadout: VANILLA_MELEE, pos: { x: 500, y: 300 } });
    const b = addDot(world, { id: "b", side: 1, loadout: VANILLA, pos: { x: 600, y: 300 } });
    applyCommand(world, "a", cmd.attack("b"));
    run(world, windUp() / 2);
    applyCommand(world, "a", cmd.move(450, 300));
    run(world, 2);
    expect(b.health).toBe(b.stats.maxHealth);
  });
});
