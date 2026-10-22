import type { BalanceData } from "@moba/balance";
import type { ServerMessage, Side } from "@moba/protocol";
import { createWorld, FixedStepper, inRect, type MapGeometry } from "@moba/sim";
import { hudStore } from "../store.js";
import { ClockSync } from "./clock.js";
import { SnapshotBuffer } from "./interpolation.js";
import { Net } from "./net.js";
import { Predictor } from "./prediction.js";
import { Renderer, type ClickMarker, type Vec } from "./renderer.js";

// Other dots are drawn two snapshot intervals in the past so there is almost always a snapshot on each side.
const INTERP_DELAY = 0.1;
const MARKER_LIFETIME = 0.4;
const PING_INTERVAL = 0.5;
// Beyond this many ticks off, the prediction clock jumps instead of easing back.
const MAX_CLOCK_DRIFT = 6;

interface Session {
  balance: BalanceData;
  geometry: MapGeometry;
  you: string;
  side: Side;
  buffer: SnapshotBuffer;
}

/** The game loop: plain TS, no React. Owns the socket, the clock, the prediction and the canvas. */
export class Game {
  private readonly renderer: Renderer;
  private readonly net: Net;
  private readonly clock = new ClockSync();
  private readonly stepper = new FixedStepper();
  private session: Session | null = null;
  private predictor: Predictor | null = null;
  private alpha = 0;
  private seq = 0;
  private pings = new Map<number, number>();
  private nextPingId = 1;
  private lastPing = -Infinity;
  private marker: ClickMarker | null = null;
  private mouse: Vec | null = null;
  private frame = 0;
  private lastFrame = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private worstCorrection = 0;
  private lastSelf: Vec | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, serverUrl: string) {
    this.renderer = new Renderer(canvas);
    this.renderer.resize();
    this.net = new Net(serverUrl, {
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => hudStore.set({ status: "disconnected" }),
    });
    this.net.addedPing = hudStore.get().addedPing;
    this.cleanup.push(hudStore.subscribe(() => (this.net.addedPing = hudStore.get().addedPing)));
    this.listen(window, "resize", () => this.renderer.resize());
    this.listen(canvas, "contextmenu", (e) => e.preventDefault());
    this.listen(canvas, "mousedown", (e) => this.onClick(e as MouseEvent));
    this.listen(canvas, "mousemove", (e) => (this.mouse = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
    this.listen(canvas, "mouseleave", () => (this.mouse = null));
    this.frame = requestAnimationFrame((t) => this.loop(t));
    // Dev builds only: lets browser tests read what is drawn. Never part of the game.
    if (import.meta.env.DEV) (window as unknown as { __moba?: Game }).__moba = this;
  }

  /** Dev/test read-out: the drawn position of your dot, the prediction tick, and the server's latest view of it. */
  debugState() {
    return {
      self: this.lastSelf,
      predicting: this.predictor !== null,
      tick: this.predictor?.tick ?? null,
      server: this.session?.buffer.latest?.self ?? null,
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    for (const off of this.cleanup) off();
    this.net.close();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.cleanup.push(() => target.removeEventListener(type, fn));
  }

  private onMessage(msg: ServerMessage): void {
    const now = performance.now() / 1000;
    switch (msg.t) {
      case "welcome": {
        // The server already validated this record; it is the pinned version for this room.
        const balance = msg.balance as BalanceData;
        const geometry = createWorld(balance).geometry;
        this.session = { balance, geometry, you: msg.you, side: msg.side, buffer: new SnapshotBuffer(msg.tickRate, INTERP_DELAY) };
        hudStore.set({ status: "connected", balanceVersion: msg.balanceVersion });
        // A few quick pings so prediction can start straight away.
        for (let i = 0; i < 3; i++) this.sendPing(now);
        break;
      }
      case "pong": {
        const sentAt = this.pings.get(msg.id);
        if (sentAt === undefined) return;
        this.pings.delete(msg.id);
        this.clock.onPong(msg.tick, sentAt, now);
        break;
      }
      case "snapshot": {
        const s = this.session;
        if (!s) return;
        s.buffer.push(msg.snap, now);
        const self = msg.snap.self;
        if (!self) return;
        if (!this.predictor && this.clock.ready) {
          this.predictor = new Predictor(s.balance, s.you, s.side, Math.round(this.clock.targetTick(now)), self);
        }
        if (this.predictor) {
          this.predictor.reconcile(msg.snap);
          this.worstCorrection = Math.max(this.worstCorrection, this.predictor.lastCorrection);
        }
        break;
      }
      case "error":
        hudStore.set({ error: msg.message });
        break;
    }
  }

  private sendPing(now: number): void {
    const id = this.nextPingId++;
    this.pings.set(id, now);
    this.net.ping(id);
    this.lastPing = now;
  }

  private onClick(e: MouseEvent): void {
    // Any button moves for now; M2 splits clicking an enemy (attack) from clicking the ground (move).
    const to = this.renderer.screenToWorld({ x: e.clientX, y: e.clientY });
    const seq = ++this.seq;
    // Before the clock has synced there is nothing to predict with; the server applies an untimed move at once.
    this.net.command(this.predictor ? this.predictor.issue({ type: "move", seq, to }) : { type: "move", seq, tick: 0, to });
    this.marker = { pos: to, age: 0 };
  }

  private loop(timeMs: number): void {
    const now = performance.now() / 1000;
    const dt = this.lastFrame ? Math.min(timeMs / 1000 - this.lastFrame, 0.25) : 0;
    this.lastFrame = timeMs / 1000;
    this.frame = requestAnimationFrame((t) => this.loop(t));

    if (this.session && now - this.lastPing >= PING_INTERVAL) this.sendPing(now);
    if (this.marker) {
      this.marker.age += dt;
      if (this.marker.age > MARKER_LIFETIME) this.marker = null;
    }

    const s = this.session;
    const p = this.predictor;
    let self: { pos: Vec; path: readonly Vec[] } | null = null;
    if (p) {
      // Keep the prediction clock at the tick the server will be on when our commands arrive:
      // ease towards it by running slightly fast or slow, or jump when it is far off.
      const drift = this.clock.targetTick(now) - (p.tick + this.alpha);
      if (Math.abs(drift) > MAX_CLOCK_DRIFT) {
        p.jumpTo(Math.round(this.clock.targetTick(now)));
        this.alpha = 0;
      } else {
        const rate = 1 + Math.min(Math.max(drift * 0.05, -0.2), 0.2);
        this.alpha = this.stepper.advance(dt * rate, () => p.step());
      }
      self = { pos: p.renderPos(this.alpha, dt), path: p.path };
    } else if (s) {
      const fromServer = s.buffer.latest?.self;
      if (fromServer) self = { pos: fromServer, path: fromServer.path };
    }

    this.lastSelf = self && { ...self.pos };
    if (s) {
      const others = s.buffer.sample(now).filter((d) => d.id !== s.you);
      if (self) this.renderer.followCamera(self.pos, dt);
      const inBrush = self ? s.geometry.brush.some((b) => inRect(self.pos, b)) : false;
      this.renderer.draw({
        balance: s.balance,
        geometry: s.geometry,
        others,
        self: self && { ...self, side: s.side, inBrush },
        marker: this.marker,
        mouse: this.mouse,
      });
    }

    this.fpsFrames++;
    const frameTime = timeMs / 1000;
    if (frameTime - this.fpsSince >= 0.5) {
      hudStore.set({
        fps: Math.round(this.fpsFrames / (frameTime - this.fpsSince)),
        position: self ? { x: Math.round(self.pos.x), y: Math.round(self.pos.y) } : null,
        rtt: Math.round(this.clock.rtt * 1000),
        correction: Math.round(this.worstCorrection * 10) / 10,
      });
      this.fpsFrames = 0;
      this.fpsSince = frameTime;
      this.worstCorrection = 0;
    }
  }
}
