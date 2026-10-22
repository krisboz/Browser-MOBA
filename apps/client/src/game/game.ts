import type { BalanceData } from "@moba/balance";
import type { CastSlot, DotSnapshot, GameEvent, Loadout, ServerMessage, Side } from "@moba/protocol";
import { createWorld, FixedStepper, inRect, type MapGeometry } from "@moba/sim";
import { hudActions, hudStore, urlPreset } from "../store.js";
import { ClockSync } from "./clock.js";
import { SnapshotBuffer } from "./interpolation.js";
import { Net } from "./net.js";
import { Predictor } from "./prediction.js";
import { Renderer, type ClickMarker, type DrawnDot, type FloatingText, type Vec } from "./renderer.js";

// Other dots are drawn two snapshot intervals in the past so there is almost always a snapshot on each side.
const INTERP_DELAY = 0.1;
const MARKER_LIFETIME = 0.4;
const NUMBER_LIFETIME = 0.9;
const PING_INTERVAL = 0.5;
// Beyond this many ticks off, the prediction clock jumps instead of easing back.
const MAX_CLOCK_DRIFT = 6;
// Extra slack around a dot for clicking on it, in pixels.
const CLICK_SLOP = 10;
const CAST_KEYS: Record<string, CastSlot> = { q: "Q", w: "W", e: "E", r: "R", d: "D", f: "F" };
const SLOTS: CastSlot[] = ["Q", "W", "E", "R", "D", "F"];

interface Session {
  balance: BalanceData;
  geometry: MapGeometry;
  tickRate: number;
  you: string;
  side: Side;
  loadout: Loadout;
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
  /** Events waiting for the drawn time to reach them, then floating as text. */
  private pendingEvents: GameEvent[] = [];
  private texts: FloatingText[] = [];
  private lastAbilityHud = 0;
  /** Enemies as last drawn, for clicking on them. */
  private drawnEnemies: DotSnapshot[] = [];
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
    this.net = new Net(serverUrl, urlPreset, {
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => hudStore.set({ status: "disconnected" }),
    });
    this.net.addedPing = hudStore.get().addedPing;
    this.cleanup.push(hudStore.subscribe(() => (this.net.addedPing = hudStore.get().addedPing)));
    hudActions.dummy = (action) => this.net.dummy(action);
    this.listen(window, "resize", () => this.renderer.resize());
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent));
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
      enemies: this.drawnEnemies,
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
        this.session = {
          balance,
          geometry: createWorld(balance).geometry,
          tickRate: msg.tickRate,
          you: msg.you,
          side: msg.side,
          loadout: msg.loadout,
          buffer: new SnapshotBuffer(msg.tickRate, INTERP_DELAY),
        };
        hudStore.set({
          status: "connected",
          balanceVersion: msg.balanceVersion,
          preset: msg.loadout.preset,
          presets: balance.presets.map((p) => p.id),
          mySide: msg.side,
        });
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
        const snap = msg.snap;
        s.buffer.push(snap, now);
        this.pendingEvents.push(...snap.events);
        hudStore.set({
          score: snap.score,
          winner: snap.winner,
          respawnIn: snap.self && !snap.self.alive ? Math.ceil(snap.self.respawnIn) : null,
          hasDummy: snap.dots.some((d) => d.dummy),
        });
        if (!snap.self) return;
        if (!this.predictor && this.clock.ready) {
          this.predictor = new Predictor(s.balance, s.you, s.side, s.loadout, Math.round(this.clock.targetTick(now)), snap.self);
        }
        if (this.predictor) {
          this.predictor.reconcile(snap);
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

  private send(
    body: { type: "move"; to: Vec } | { type: "attack"; target: string } | { type: "stop" } | { type: "cast"; slot: CastSlot; aim: Vec },
  ): void {
    const seq = ++this.seq;
    // Before the clock has synced there is nothing to predict with; the server applies an untimed command at once.
    this.net.command(this.predictor ? this.predictor.issue({ ...body, seq }) : { ...body, seq, tick: 0 });
  }

  private enemyAt(screen: Vec): DotSnapshot | null {
    const s = this.session;
    if (!s) return null;
    const p = this.renderer.screenToWorld(screen);
    let best: DotSnapshot | null = null;
    let bestDist = s.balance.dot.radius + CLICK_SLOP;
    for (const d of this.drawnEnemies) {
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd <= bestDist) {
        best = d;
        bestDist = dd;
      }
    }
    return best;
  }

  private onClick(e: MouseEvent): void {
    // Right click: attack the enemy under the cursor, or walk. Left click does the same until M3 claims it for aiming.
    if (e.button !== 0 && e.button !== 2) return;
    const enemy = this.enemyAt({ x: e.clientX, y: e.clientY });
    if (enemy) {
      this.send({ type: "attack", target: enemy.id });
      return;
    }
    const to = this.renderer.screenToWorld({ x: e.clientX, y: e.clientY });
    this.send({ type: "move", to });
    this.marker = { pos: to, age: 0 };
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "s") return this.send({ type: "stop" });
    const slot = CAST_KEYS[key];
    if (!slot) return;
    // Quick cast: goes off toward wherever the cursor is.
    const aim = this.mouse ? this.renderer.screenToWorld(this.mouse) : this.lastSelf;
    if (aim) this.send({ type: "cast", slot, aim });
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
    let selfPos: Vec | null = null;
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
      selfPos = p.renderPos(this.alpha, dt);
    } else if (s?.buffer.latest?.self) {
      selfPos = s.buffer.latest.self;
    }
    this.lastSelf = selfPos && { ...selfPos };

    if (s) this.draw(s, now, dt, selfPos);
    if (s && now - this.lastAbilityHud > 0.1) this.updateAbilityBar(s, now);

    this.fpsFrames++;
    const frameTime = timeMs / 1000;
    if (frameTime - this.fpsSince >= 0.5) {
      hudStore.set({
        fps: Math.round(this.fpsFrames / (frameTime - this.fpsSince)),
        position: selfPos ? { x: Math.round(selfPos.x), y: Math.round(selfPos.y) } : null,
        rtt: Math.round(this.clock.rtt * 1000),
        correction: Math.round(this.worstCorrection * 10) / 10,
      });
      this.fpsFrames = 0;
      this.fpsSince = frameTime;
      this.worstCorrection = 0;
    }
  }

  private updateAbilityBar(s: Session, now: number): void {
    this.lastAbilityHud = now;
    const cooldowns = this.predictor?.self.cooldowns ?? s.buffer.latest?.self?.cooldowns;
    if (!cooldowns) return;
    const ids: Record<CastSlot, string | null> = { ...s.loadout.abilities, D: s.loadout.summoners[0], F: s.loadout.summoners[1] };
    hudStore.set({
      abilities: SLOTS.flatMap((slot) => {
        const def = ids[slot] ? s.balance.abilities.find((a) => a.id === ids[slot]) ?? s.balance.summoners.find((a) => a.id === ids[slot]) : undefined;
        return def ? [{ slot, name: def.name, cooldown: Math.round(cooldowns[slot] * 10) / 10, max: def.cooldown }] : [];
      }),
    });
  }

  private draw(s: Session, now: number, dt: number, selfPos: Vec | null): void {
    const sample = s.buffer.sample(now);
    const hovered = this.mouse ? this.enemyAt(this.mouse)?.id : undefined;
    const inBrush = (pos: Vec) => s.geometry.brush.some((b) => inRect(pos, b));
    const since = (tick: number) => (tick < 0 ? null : sample.time - tick / s.tickRate);
    const drawnAt = new Map<string, Vec>();

    const dots: DrawnDot[] = [];
    for (const d of sample.dots) {
      if (!d.alive) continue;
      const isSelf = d.id === s.you;
      const pos = isSelf && selfPos ? selfPos : d;
      dots.push({
        pos,
        side: d.side,
        // Your own facing follows your prediction while walking, the server while winding up.
        facing: isSelf && this.predictor && d.windUp === null ? this.predictor.facing : d.facing,
        health: d.health,
        maxHealth: d.maxHealth,
        windUp: d.windUp,
        sinceRelease: since(d.lastReleaseTick),
        cast: d.cast,
        sinceCast: since(d.lastCastTick),
        status: d.status,
        motion: d.motion,
        channelling: d.channelling,
        isSelf,
        inBrush: inBrush(pos),
        dummy: d.dummy,
        hovered: d.id === hovered,
      });
      drawnAt.set(d.id, pos);
    }
    this.drawnEnemies = sample.dots.filter((d) => d.alive && d.side !== s.side);
    if (selfPos) this.renderer.followCamera(selfPos, dt);

    // Damage numbers appear when the drawn time reaches the hit, so they line up with the hit on screen.
    const due = this.pendingEvents.filter((e) => e.tick / s.tickRate <= sample.time);
    this.pendingEvents = this.pendingEvents.filter((e) => e.tick / s.tickRate > sample.time);
    for (const e of due) {
      if (e.kind === "hit") this.texts.push({ x: e.x, y: e.y, text: String(Math.round(e.amount)), color: e.ability ? "#ffcc80" : "#fff3c4", age: 0 });
      if (e.kind === "blocked") this.texts.push({ x: e.x, y: e.y, text: "BLOCKED", color: "#ce93d8", age: 0 });
      if (e.kind === "heal" && e.amount > 0) this.texts.push({ x: e.x, y: e.y, text: `+${Math.round(e.amount)}`, color: "#a5d6a7", age: 0 });
    }
    for (const n of this.texts) n.age += dt;
    this.texts = this.texts.filter((n) => n.age < NUMBER_LIFETIME);

    this.renderer.draw({
      balance: s.balance,
      geometry: s.geometry,
      dots,
      projectiles: sample.projectiles,
      spells: sample.spells,
      drawnAt,
      path: this.predictor?.path ?? [],
      pathFrom: selfPos,
      texts: this.texts,
      marker: this.marker,
      mouse: this.mouse,
    });
  }
}
