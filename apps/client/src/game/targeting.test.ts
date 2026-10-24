import { describe, expect, it } from "vitest";
import type { DotSnapshot } from "@moba/protocol";
import { closestEnemy, enemyUnder } from "./targeting.js";

const enemy = (id: string, x: number, y: number) => ({ id, x, y }) as DotSnapshot;
const enemies = [enemy("near", 1000, 300), enemy("far", 1600, 300)];

describe("targeting", () => {
  it("finds the enemy under the cursor, or nothing on empty ground", () => {
    expect(enemyUnder(enemies, { x: 1010, y: 310 }, 40)?.id).toBe("near");
    expect(enemyUnder(enemies, { x: 1300, y: 300 }, 40)).toBeNull();
  });

  it("attack move on empty ground picks the enemy closest to the cursor", () => {
    expect(closestEnemy(enemies, { x: 1400, y: 100 })?.id).toBe("far");
    expect(closestEnemy(enemies, { x: 1200, y: 500 })?.id).toBe("near");
    expect(closestEnemy([], { x: 0, y: 0 })).toBeNull();
  });
});
