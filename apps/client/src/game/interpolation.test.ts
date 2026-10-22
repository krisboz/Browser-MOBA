import { describe, expect, it } from "vitest";
import { SnapshotBuffer } from "./interpolation.js";

const snap = (tick: number, x: number) => ({ tick, ackSeq: 0, self: null, dots: [{ id: "a", side: 0 as const, x, y: 0 }] });

describe("SnapshotBuffer", () => {
  it("blends between the two snapshots around the render time", () => {
    const buf = new SnapshotBuffer(30, 0.1);
    // Snapshots 3 ticks (0.1 s) apart, arriving with a fixed 1 s clock offset.
    buf.push(snap(30, 0), 2.0);
    buf.push(snap(33, 30), 2.1);
    buf.push(snap(36, 60), 2.2);
    // Render time 2.25 - 1 (offset) - 0.1 (delay) = 1.15 s server time, halfway between ticks 33 and 36.
    expect(buf.sample(2.25)[0]!.x).toBeCloseTo(45, 6);
  });

  it("follows latency that rises instead of freezing on the newest snapshot", () => {
    const buf = new SnapshotBuffer(30, 0.1);
    for (let i = 0; i < 20; i++) buf.push(snap(30 + i * 3, i * 30), 2.0 + i * 0.1);
    // Latency jumps by 80 ms: snapshots keep coming every 0.1 s, each 80 ms later than before.
    for (let i = 20; i < 120; i++) buf.push(snap(30 + i * 3, i * 30), 2.08 + i * 0.1);
    const now = 2.08 + 119 * 0.1;
    // Rendering 0.1 s behind the newest snapshot again, not stuck on it.
    expect(buf.sample(now)[0]!.x).toBeCloseTo(119 * 30 - 30, 0);
  });

  it("holds the newest snapshot when the render time runs past it", () => {
    const buf = new SnapshotBuffer(30, 0.1);
    buf.push(snap(30, 0), 2.0);
    buf.push(snap(33, 30), 2.1);
    expect(buf.sample(5)[0]!.x).toBe(30);
  });
});
