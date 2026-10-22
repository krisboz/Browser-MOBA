import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { addDot, createWorld, snapshot } from "./index.js";
import { VANILLA } from "./test-helpers.js";

const [top, bottom] = seedV1.map.brush;
const inside = (b: typeof top) => ({ x: b!.x + b!.w / 2, y: b!.y + b!.h / 2 });

describe("brush vision", () => {
  it("hides a dot in brush from the other side's snapshot, never from its own", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "blue", side: 0, loadout: VANILLA, pos: { x: 800, y: 300 } });
    addDot(world, { id: "red", side: 1, loadout: VANILLA, pos: inside(top) });

    const blueView = snapshot(world, { side: 0, dotId: "blue" }, 0);
    expect(blueView.dots.map((d) => d.id)).toEqual(["blue"]);

    const redView = snapshot(world, { side: 1, dotId: "red" }, 0);
    expect(redView.dots.map((d) => d.id).sort()).toEqual(["blue", "red"]);
    expect(redView.self).toMatchObject(inside(top));
  });

  it("shows a dot in brush to an enemy standing in the same patch only", () => {
    const world = createWorld(seedV1);
    addDot(world, { id: "red", side: 1, loadout: VANILLA, pos: inside(top) });
    const blue = addDot(world, { id: "blue", side: 0, loadout: VANILLA, pos: inside(bottom) });
    expect(snapshot(world, { side: 0, dotId: "blue" }, 0).dots.map((d) => d.id)).toEqual(["blue"]);

    blue.pos = { x: top!.x + 20, y: top!.y + 20 };
    expect(snapshot(world, { side: 0, dotId: "blue" }, 0).dots.map((d) => d.id).sort()).toEqual(["blue", "red"]);
  });
});
