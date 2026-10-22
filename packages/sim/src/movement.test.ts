import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { addDot, applyCommand, createWorld, FixedStepper, step, TICK_RATE } from "./index.js";

// An open lane long enough that 10 s of walking never reaches the end. The walk runs along y = 100, clear of the towers.
const balance = { ...seedV1, map: { ...seedV1.map, length: 10_000, walls: [] } };

/** Walks a dot toward the far end for `seconds`, driving the sim from render frames of `frameTime` seconds. */
function walk(frameTimes: () => number, seconds: number) {
  const world = createWorld(balance);
  const dot = addDot(world, "a", 0, { x: 100, y: 100 });
  applyCommand(world, "a", { type: "move", seq: 1, tick: 0, to: { x: 9_900, y: 100 } });
  const stepper = new FixedStepper();
  let t = 0;
  while (t < seconds - 1e-9) {
    const dt = Math.min(frameTimes(), seconds - t);
    t += dt;
    stepper.advance(dt, () => step(world));
  }
  return { distance: dot.pos.x - 100, ticks: world.tick };
}

describe("movement over fixed ticks", () => {
  it("walks 300 units/s, the same distance at 60 Hz and 144 Hz", () => {
    const at60 = walk(() => 1 / 60, 10);
    const at144 = walk(() => 1 / 144, 10);
    expect(at60.ticks).toBe(10 * TICK_RATE);
    expect(at144.ticks).toBe(10 * TICK_RATE);
    expect(at60.distance).toBeCloseTo(3000, 6);
    expect(at144.distance).toBeCloseTo(at60.distance, 9);
  });

  it("is unaffected by uneven frame times", () => {
    let seed = 1;
    const jittery = () => {
      seed = (seed * 16807) % 2147483647;
      return 0.004 + (seed / 2147483647) * 0.03; // 4 to 34 ms frames
    };
    const { distance } = walk(jittery, 10);
    // Within one tick of the exact answer: the last partial tick may not have run yet.
    expect(Math.abs(distance - 3000)).toBeLessThanOrEqual(balance.dot.moveSpeed / TICK_RATE + 1e-6);
  });

  it("stops exactly on the target", () => {
    const world = createWorld(balance);
    const dot = addDot(world, "a", 0, { x: 100, y: 100 });
    applyCommand(world, "a", { type: "move", seq: 1, tick: 0, to: { x: 145, y: 100 } });
    for (let i = 0; i < 30; i++) step(world);
    expect(dot.pos).toEqual({ x: 145, y: 100 });
    expect(dot.path).toEqual([]);
  });

  it("keeps move targets inside the lane", () => {
    const world = createWorld(seedV1);
    addDot(world, "a", 0);
    applyCommand(world, "a", { type: "move", seq: 1, tick: 0, to: { x: 100, y: 99_999 } });
    expect(world.dots.get("a")!.path.at(-1)).toEqual({ x: 100, y: seedV1.map.width - seedV1.dot.radius });
  });
});
