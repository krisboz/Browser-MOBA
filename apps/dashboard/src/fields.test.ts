import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import { checkBalance } from "./check.js";
import { diff, flatten, matches, setAt } from "./fields.js";

describe("the balance record as fields", () => {
  it("lists every value, naming array entries by their id", () => {
    const fields = flatten(seedV1);
    const bolt = fields.find((f) => f.label === "abilities › bolt › blocks › 0 › onHit › 0 › base");
    expect(bolt).toMatchObject({ value: 120, path: ["abilities", 0, "blocks", 0, "onHit", 0, "base"] });
    expect(fields.find((f) => f.label === "towers › range")?.value).toBe(500);
    // Walls have no id: named by position.
    expect(fields.some((f) => f.label === "map › walls › 0 › x")).toBe(true);
  });

  it("finds a value by words in any order", () => {
    const found = flatten(seedV1).filter((f) => matches(f.label, "bolt base"));
    expect(found.map((f) => f.label)).toEqual(["abilities › bolt › blocks › 0 › onHit › 0 › base"]);
  });

  it("changes one value without touching the original, and reports exactly that change", () => {
    const path = ["abilities", 0, "blocks", 0, "onHit", 0, "base"];
    const edited = setAt(seedV1, path, 150);
    expect(seedV1.abilities[0]!.blocks[0]).toMatchObject({ onHit: [{ base: 120 }] });
    expect(edited.abilities[0]!.blocks[0]).toMatchObject({ onHit: [{ base: 150 }] });
    expect(edited.towers).toBe(seedV1.towers); // untouched branches are shared
    expect(diff(seedV1, edited)).toEqual([{ label: "abilities › bolt › blocks › 0 › onHit › 0 › base", from: 120, to: 150 }]);
    expect(checkBalance(edited).ok).toBe(true);
  });

  it("reports values added or removed in the JSON editor", () => {
    const fewer = { ...seedV1, items: seedV1.items.slice(1) };
    const changes = diff(seedV1, fewer);
    expect(changes.some((c) => c.label.startsWith("items › heart") && c.to === undefined)).toBe(true);
  });

  it("refuses what the game server would refuse", () => {
    const negative = setAt(seedV1, ["dot", "moveSpeed"], -5);
    expect(checkBalance(negative)).toMatchObject({ ok: false, issues: [expect.stringMatching(/dot\.moveSpeed/)] });
    const walled = { ...seedV1, map: { ...seedV1.map, walls: [{ x: 1500, y: 0, w: 20, h: 600 }] } };
    expect(checkBalance(walled)).toMatchObject({ ok: false, issues: [expect.stringMatching(/no path/)] });
  });
});
