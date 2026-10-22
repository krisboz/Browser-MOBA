import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { addDot, applyCommand, createWorld, dist, findPath, isClear, isSegmentClear, step, TICK_RATE, validateMap, type Vec } from "./index.js";
import { VANILLA } from "./test-helpers.js";

const r = seedV1.dot.radius;

/** Every point a dot passes through while walking `path` from `from`, sampled finely. */
function assertWalkable(world: ReturnType<typeof createWorld>, from: Vec, path: Vec[]) {
  let a = from;
  for (const b of path) {
    expect(isSegmentClear(world.geometry, a, b, r), `leg (${a.x}, ${a.y}) -> (${b.x}, ${b.y})`).toBe(true);
    a = b;
  }
}

describe("pathing on the lane map", () => {
  const world = createWorld(seedV1);
  const [blue, red] = world.geometry.spawns;

  it("walks base to base around every obstacle with one click", () => {
    const dot = addDot(world, { id: "a", side: 0, loadout: VANILLA });
    applyCommand(world, "a", { type: "move", seq: 1, tick: 0, to: red });
    assertWalkable(world, blue, dot.path);

    // Both towers sit on the straight line between the bases, so the path has to bend.
    expect(dot.path.length).toBeGreaterThan(1);
    const length = dot.path.reduce((acc, p, i) => acc + dist(i ? dot.path[i - 1]! : blue, p), 0);
    expect(length).toBeLessThan(dist(blue, red) * 1.1);

    let ticks = 0;
    while (dot.path.length && ticks < 60 * TICK_RATE) {
      step(world);
      ticks++;
      expect(isClear(world.geometry, dot.pos, r)).toBe(true);
    }
    expect(dot.pos).toEqual(red);
    // Walking at full speed the whole way: no stalls against walls.
    expect(ticks).toBeLessThanOrEqual(Math.ceil((length / seedV1.dot.moveSpeed) * TICK_RATE) + 1);
    world.dots.delete("a");
  });

  it("goes around a wall to reach the far side of it", () => {
    // Just past the top outcrop, starting just before it.
    const from = { x: 1100, y: 60 };
    const to = { x: 1350, y: 60 };
    const path = findPath(world.nav, from, to);
    assertWalkable(world, from, path);
    expect(path.at(-1)).toEqual(to);
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(180 + r - 1);
  });

  it("walks straight when nothing is in the way", () => {
    expect(findPath(world.nav, { x: 400, y: 100 }, { x: 600, y: 120 })).toEqual([{ x: 600, y: 120 }]);
  });

  it("stops at the nearest standable spot when the click is inside a wall or a tower", () => {
    const intoWall = findPath(world.nav, { x: 1000, y: 300 }, { x: 1225, y: 50 });
    const end = intoWall.at(-1)!;
    expect(isClear(world.geometry, end, r)).toBe(true);
    // The outcrop spans x 1150..1300 from the top edge: stepping out of its left side is the shortest way.
    expect(end).toEqual({ x: 1150 - r, y: 50 });

    const intoTower = findPath(world.nav, blue, world.geometry.towers[0]);
    expect(isClear(world.geometry, intoTower.at(-1)!, r)).toBe(true);
    expect(dist(intoTower.at(-1)!, world.geometry.towers[0])).toBeCloseTo(seedV1.towers.radius + r, 6);
  });

  it("is deterministic, so client and server agree on every path", () => {
    expect(findPath(world.nav, blue, red)).toEqual(findPath(createWorld(structuredClone(seedV1)).nav, blue, red));
  });
});

describe("validateMap", () => {
  it("accepts the version 1 lane", () => {
    expect(validateMap(seedV1)).toEqual([]);
  });

  it("rejects a wall that cuts the lane in two", () => {
    const walled = { ...seedV1, map: { ...seedV1.map, walls: [{ x: 1500, y: 0, w: 20, h: 600 }] } };
    expect(validateMap(walled)).toEqual(["map: no path from one base to the other"]);
  });

  it("rejects a blocked spawn", () => {
    const blocked = { ...seedV1, map: { ...seedV1.map, walls: [{ x: 100, y: 250, w: 100, h: 100 }] } };
    expect(validateMap(blocked)[0]).toMatch(/side 0 spawn .* is blocked/);
  });
});
