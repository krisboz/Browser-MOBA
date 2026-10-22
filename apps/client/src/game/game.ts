import type { BalanceData } from "@moba/balance";
import type { ServerMessage } from "@moba/protocol";
import { hudStore } from "../store.js";
import { SnapshotBuffer } from "./interpolation.js";
import { Net } from "./net.js";
import { Renderer, type ClickMarker, type Vec } from "./renderer.js";

// Draw two snapshot intervals in the past so there is almost always a snapshot on each side.
const INTERP_DELAY = 0.1;
const MARKER_LIFETIME = 0.4;

/** The game loop: plain TS, no React. Owns the socket, the snapshot buffer and the canvas. */
export class Game {
  private readonly renderer: Renderer;
  private readonly net: Net;
  private balance: BalanceData | null = null;
  private buffer: SnapshotBuffer | null = null;
  private you: string | null = null;
  private marker: ClickMarker | null = null;
  private mouse: Vec | null = null;
  private frame = 0;
  private lastFrame = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private readonly cleanup: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, serverUrl: string) {
    this.renderer = new Renderer(canvas);
    this.renderer.resize();
    this.net = new Net(serverUrl, {
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => hudStore.set({ status: "disconnected" }),
    });
    this.listen(window, "resize", () => this.renderer.resize());
    this.listen(canvas, "contextmenu", (e) => e.preventDefault());
    this.listen(canvas, "mousedown", (e) => this.onClick(e as MouseEvent));
    this.listen(canvas, "mousemove", (e) => (this.mouse = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
    this.listen(canvas, "mouseleave", () => (this.mouse = null));
    this.frame = requestAnimationFrame((t) => this.loop(t));
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
    switch (msg.t) {
      case "welcome":
        // The server already validated this record; it is the pinned version for this room.
        this.balance = msg.balance as BalanceData;
        this.buffer = new SnapshotBuffer(msg.tickRate, INTERP_DELAY);
        this.you = msg.you;
        hudStore.set({ status: "connected", balanceVersion: msg.balanceVersion });
        break;
      case "snapshot":
        this.buffer?.push(msg.snap, performance.now() / 1000);
        break;
      case "error":
        hudStore.set({ error: msg.message });
        break;
    }
  }

  private onClick(e: MouseEvent): void {
    // Any button moves for now; M2 splits clicking an enemy (attack) from clicking the ground (move).
    const to = this.renderer.screenToWorld({ x: e.clientX, y: e.clientY });
    this.net.send({ type: "move", to });
    this.marker = { pos: to, age: 0 };
  }

  private loop(timeMs: number): void {
    const now = timeMs / 1000;
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 0.25) : 0;
    this.lastFrame = now;
    this.frame = requestAnimationFrame((t) => this.loop(t));

    if (this.marker) {
      this.marker.age += dt;
      if (this.marker.age > MARKER_LIFETIME) this.marker = null;
    }

    const dots = this.buffer?.sample(performance.now() / 1000) ?? [];
    const me = dots.find((d) => d.id === this.you);
    if (me) this.renderer.followCamera(me, dt);
    if (this.balance) this.renderer.draw(this.balance, dots, this.you, this.marker, this.mouse);

    this.fpsFrames++;
    if (now - this.fpsSince >= 0.5) {
      const position = me ? { x: Math.round(me.x), y: Math.round(me.y) } : null;
      hudStore.set({ fps: Math.round(this.fpsFrames / (now - this.fpsSince)), position });
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
  }
}
