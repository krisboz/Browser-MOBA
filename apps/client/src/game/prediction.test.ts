import { describe, expect, it } from "vitest";
import { seedV1 } from "@moba/balance";
import type { Command, Snapshot } from "@moba/protocol";
import { addDot, applyCommand, createWorld, selfState, snapshot, step } from "@moba/sim";
import { ClockSync } from "./clock.js";
import { Predictor } from "./prediction.js";

/**
 * A server and a client exchanging messages with a fixed one-way delay, all counted in ticks.
 * The server side mirrors apps/server's Room: commands wait for their tick, late ones run at once.
 */
function harness({ oneWay, lead, dummyAt }: { oneWay: number; lead: number; dummyAt?: { x: number; y: number } }) {
  const server = createWorld(seedV1);
  const loadout = { preset: null, range: "ranged" as const, points: {} };
  const dot = addDot(server, { id: "p1", side: 0, loadout });
  if (dummyAt) addDot(server, { id: "dummy", side: 1, loadout, pos: dummyAt, dummy: true });
  const toServer: { at: number; cmd: Command }[] = [];
  const toClient: { at: number; snap: Snapshot }[] = [];
  const queue: Command[] = [];
  let ackSeq = 0;
  let seq = 0;
  let t = 0;

  const client = new Predictor(seedV1, "p1", 0, loadout, server.tick + lead, selfState(dot));
  const corrections: number[] = [];

  function tick(click?: { x: number; y: number } | { attack: string }) {
    // Server
    while (toServer.length && toServer[0]!.at <= t) queue.push(toServer.shift()!.cmd);
    for (const cmd of queue.filter((c) => c.tick <= server.tick)) {
      applyCommand(server, "p1", cmd);
      ackSeq = Math.max(ackSeq, cmd.seq);
    }
    queue.splice(0, queue.length, ...queue.filter((c) => c.tick > server.tick));
    step(server);
    toClient.push({ at: t + oneWay, snap: snapshot(server, { side: 0, dotId: "p1" }, ackSeq) });

    // Client
    while (toClient.length && toClient[0]!.at <= t) {
      client.reconcile(toClient.shift()!.snap);
      corrections.push(client.lastCorrection);
    }
    if (click) {
      const body = "attack" in click ? { type: "attack" as const, seq: ++seq, target: click.attack } : { type: "move" as const, seq: ++seq, to: click };
      toServer.push({ at: t + oneWay, cmd: client.issue(body) });
    }
    client.step();
    t++;
  }

  return { server: dot, client, corrections, tick };
}

describe("own-movement prediction", () => {
  it("moves on the very next tick after a click, whatever the latency", () => {
    const h = harness({ oneWay: 4, lead: 4 + 2 });
    for (let i = 0; i < 10; i++) h.tick();
    const before = { ...h.client.pos };
    h.tick({ x: 900, y: 300 });
    expect(Math.hypot(h.client.pos.x - before.x, h.client.pos.y - before.y)).toBeCloseTo(seedV1.dot.moveSpeed / 30, 6);
  });

  it("never needs a correction when the clock leads by at least the one-way trip", () => {
    const h = harness({ oneWay: 4, lead: 4 + 2 });
    for (let i = 0; i < 5; i++) h.tick();
    h.tick({ x: 2850, y: 300 }); // base to base, around both towers
    for (let i = 0; i < 40; i++) h.tick();
    h.tick({ x: 800, y: 100 }); // change of mind mid-walk
    for (let i = 0; i < 200; i++) h.tick();
    expect(Math.max(...h.corrections)).toBeLessThan(1e-9);
    expect(h.client.pos).toEqual(h.server.pos);
  });

  it("predicts walking into range of an attack target without corrections", () => {
    const h = harness({ oneWay: 4, lead: 4 + 2, dummyAt: { x: 1500, y: 300 } });
    for (let i = 0; i < 10; i++) h.tick(); // a snapshot arrives, so the client sees the dummy
    h.tick({ attack: "dummy" });
    for (let i = 0; i < 200; i++) h.tick();
    expect(Math.max(...h.corrections)).toBeLessThan(1e-6);
    expect(h.client.pos).toEqual(h.server.pos);
    // Stopped in range (450 from its centre to the dummy's edge), not on top of it.
    const gap = Math.hypot(1500 - h.server.pos.x, 300 - h.server.pos.y);
    expect(gap).toBeLessThanOrEqual(450 + 30 + 1e-6);
    expect(gap).toBeGreaterThan(450 + 30 - 3);
  });

  it("corrects to the server's position when commands arrive late", () => {
    const h = harness({ oneWay: 4, lead: 0 });
    for (let i = 0; i < 5; i++) h.tick();
    h.tick({ x: 900, y: 300 });
    for (let i = 0; i < 100; i++) h.tick();
    expect(Math.max(...h.corrections)).toBeGreaterThan(1);
    expect(h.client.pos).toEqual(h.server.pos);
  });

  it("draws a correction as a fade, not a jump", () => {
    const h = harness({ oneWay: 4, lead: 0 });
    for (let i = 0; i < 5; i++) h.tick();
    h.tick({ x: 900, y: 300 });
    const drawn: number[] = [];
    for (let i = 0; i < 40; i++) {
      h.tick();
      drawn.push(h.client.renderPos(1, 1 / 30).x);
    }
    const biggestFrameJump = Math.max(...drawn.slice(1).map((x, i) => Math.abs(x - drawn[i]!)));
    // A late command puts the server 4 ticks behind (40 units); drawn per frame it never jumps by more than ~1.5 ticks of walking.
    expect(biggestFrameJump).toBeLessThan(15);
  });
});

describe("ClockSync", () => {
  it("leads the server by half a round trip plus a small buffer", () => {
    const clock = new ClockSync();
    // 100 ms round trip; the server was on tick 300 when it replied.
    clock.onPong(300, 10.0, 10.1);
    expect(clock.rtt).toBeCloseTo(0.1, 9);
    expect(clock.serverTick(10.1)).toBeCloseTo(301.5, 9);
    expect(clock.targetTick(10.1)).toBeCloseTo(301.5 + 1.5 + 2, 9);
    expect(clock.serverTick(11.1)).toBeCloseTo(331.5, 9);
  });

  it("ignores a single slow reply", () => {
    const clock = new ClockSync();
    for (let i = 0; i < 4; i++) clock.onPong(0, i, i + 0.05);
    clock.onPong(0, 10, 10.9);
    expect(clock.rtt).toBeCloseTo(0.05, 9);
  });
});
