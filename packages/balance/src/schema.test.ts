import { describe, expect, it } from "vitest";
import { parseBalance, seedV1 } from "./index.js";

const clone = () => structuredClone(seedV1);

describe("balance schema", () => {
  it("accepts the version 1 seed", () => {
    const result = parseBalance(seedV1);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("rejects a missing section", () => {
    const { towers: _, ...rest } = clone();
    expect(parseBalance(rest).ok).toBe(false);
  });

  it("rejects a negative number", () => {
    const b = clone();
    b.dot.moveSpeed = -300;
    expect(parseBalance(b).ok).toBe(false);
  });

  it("rejects a preset over the point cap or budget", () => {
    const overCap = clone();
    overCap.presets[0]!.points.magicAttack = 11;
    expect(parseBalance(overCap).ok).toBe(false);

    const overBudget = clone();
    overBudget.presets[0]!.points.armor = 1;
    const result = parseBalance(overBudget);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join("\n")).toMatch(/over the budget/);
  });

  it("rejects a preset with an unknown ability or one in the wrong slot", () => {
    const unknown = clone();
    unknown.presets[0]!.abilities.Q = "nope";
    expect(parseBalance(unknown).ok).toBe(false);

    const wrongSlot = clone();
    wrongSlot.presets[0]!.abilities.Q = "dash";
    expect(parseBalance(wrongSlot).ok).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const b = clone();
    b.items.push({ ...b.items[0]! });
    expect(parseBalance(b).ok).toBe(false);
  });

  it("rejects unknown fields so typos don't silently do nothing", () => {
    const b = clone() as unknown as { dot: Record<string, unknown> };
    b.dot.moveSpeeed = 400;
    expect(parseBalance(b).ok).toBe(false);
  });
});
