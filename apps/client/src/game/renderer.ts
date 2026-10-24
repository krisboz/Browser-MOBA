import type { BalanceData } from "@moba/balance";
import type { DotSnapshot, DotStatus, ProjectileSnapshot, Side, SpellSnapshot, UnitKind } from "@moba/protocol";
import type { MapGeometry } from "@moba/sim";
import { armPose } from "./arms.js";

export interface Vec {
  x: number;
  y: number;
}

export interface ClickMarker {
  pos: Vec;
  age: number;
  /** An attack move: drawn red. */
  attack?: boolean;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  /** Seconds since it appeared. */
  age: number;
}

/** A unit as drawn: interpolated server state, with your own dot's position (and facing) from prediction. */
export interface DrawnDot {
  pos: Vec;
  kind: UnitKind;
  radius: number;
  ranged: boolean;
  /** Only fallen towers are drawn dead, as rubble. */
  alive: boolean;
  side: Side;
  facing: number;
  health: number;
  maxHealth: number;
  windUp: number | null;
  sinceRelease: number | null;
  cast: number | null;
  sinceCast: number | null;
  status: DotStatus;
  motion: DotSnapshot["motion"];
  channelling: boolean;
  isSelf: boolean;
  inBrush: boolean;
  dummy: boolean;
  /** An enemy under the cursor: right click attacks it. */
  hovered: boolean;
}

/** An enemy tower's reach, drawn when you come near it. */
export interface TowerRing {
  pos: Vec;
  range: number;
  /** It is shooting at you. */
  onYou: boolean;
}

export interface Scene {
  balance: BalanceData;
  geometry: MapGeometry;
  dots: DrawnDot[];
  projectiles: ProjectileSnapshot[];
  spells: SpellSnapshot[];
  /** Where each dot is drawn, for lines from a hook back to its thrower. */
  drawnAt: Map<string, Vec>;
  path: readonly Vec[];
  pathFrom: Vec | null;
  texts: FloatingText[];
  marker: ClickMarker | null;
  mouse: Vec | null;
  towerRing: TowerRing | null;
}

export type { DotSnapshot };

const COLORS = {
  ground: "#1b2a1f",
  lane: "#2d3b2f",
  base: ["#1d3557", "#5a1d1d"],
  wall: "#4a4f57",
  brush: "#1f4d2b",
  grid: "rgba(255,255,255,0.04)",
  side: ["#4ea8ff", "#ff5d5d"],
  minion: ["#3a7fc4", "#c44a4a"],
  rubble: "#33363b",
  self: "#ffffff",
  hover: "#ffd54f",
  healthBack: "rgba(0,0,0,0.55)",
  health: ["#7fd1ff", "#ff8a8a"],
  number: "#fff3c4",
  root: "#a1887f",
  stun: "#ffeb3b",
  slow: "#81d4fa",
  spellShield: "#ce93d8",
  barrier: "#ffffff",
  hook: "#d7b56d",
  path: "rgba(159,232,112,0.35)",
  marker: "#9fe870",
  attackMarker: "#ff5252",
  cursor: "#ffffff",
};

/** Canvas drawing. The world is drawn at 1:1 around a camera that follows your dot. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  readonly camera: Vec = { x: 0, y: 0 };
  private cameraPlaced = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d not supported");
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  worldToScreen(p: Vec): Vec {
    return { x: p.x - this.camera.x + window.innerWidth / 2, y: p.y - this.camera.y + window.innerHeight / 2 };
  }

  screenToWorld(p: Vec): Vec {
    return { x: p.x + this.camera.x - window.innerWidth / 2, y: p.y + this.camera.y - window.innerHeight / 2 };
  }

  /** Same smoothing as the old demo (8% per 60 Hz frame), expressed per second. */
  followCamera(target: Vec, dt: number): void {
    if (!this.cameraPlaced) {
      this.camera.x = target.x;
      this.camera.y = target.y;
      this.cameraPlaced = true;
      return;
    }
    const k = 1 - Math.pow(1 - 0.08, dt * 60);
    this.camera.x += (target.x - this.camera.x) * k;
    this.camera.y += (target.y - this.camera.y) * k;
  }

  draw(scene: Scene): void {
    const { ctx } = this;
    const { balance, geometry: g } = scene;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const o = this.worldToScreen({ x: 0, y: 0 });
    const { baseDepth } = balance.map;
    ctx.fillStyle = COLORS.lane;
    ctx.fillRect(o.x, o.y, g.length, g.width);
    ctx.fillStyle = COLORS.base[0]!;
    ctx.fillRect(o.x, o.y, baseDepth, g.width);
    ctx.fillStyle = COLORS.base[1]!;
    ctx.fillRect(o.x + g.length - baseDepth, o.y, baseDepth, g.width);
    ctx.fillStyle = COLORS.brush;
    for (const b of g.brush) ctx.fillRect(o.x + b.x, o.y + b.y, b.w, b.h);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= g.length; x += 100) {
      ctx.moveTo(o.x + x, o.y);
      ctx.lineTo(o.x + x, o.y + g.width);
    }
    for (let y = 0; y <= g.width; y += 100) {
      ctx.moveTo(o.x, o.y + y);
      ctx.lineTo(o.x + g.length, o.y + y);
    }
    ctx.stroke();

    ctx.fillStyle = COLORS.wall;
    for (const w of g.walls) ctx.fillRect(o.x + w.x, o.y + w.y, w.w, w.h);
    g.pillars.forEach((t, side) => {
      const p = this.worldToScreen(t);
      const unit = scene.dots.find((d) => d.kind === "tower" && d.side === side);
      const fallen = unit && !unit.alive;
      ctx.fillStyle = fallen ? COLORS.rubble : COLORS.wall;
      ctx.beginPath();
      ctx.arc(p.x, p.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      if (fallen) return;
      ctx.strokeStyle = unit?.hovered ? COLORS.hover : COLORS.side[side]!;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = COLORS.side[side]!;
      ctx.beginPath();
      ctx.arc(p.x, p.y, t.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    });
    const ring = scene.towerRing;
    if (ring) {
      const p = this.worldToScreen(ring.pos);
      ctx.strokeStyle = ring.onYou ? "rgba(255,82,82,0.9)" : "rgba(255,255,255,0.25)";
      ctx.lineWidth = ring.onYou ? 3 : 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ring.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const { marker } = scene;
    if (scene.pathFrom && scene.path.length) {
      ctx.strokeStyle = COLORS.path;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      const start = this.worldToScreen(scene.pathFrom);
      ctx.moveTo(start.x, start.y);
      for (const w of scene.path) {
        const p = this.worldToScreen(w);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (marker) {
      const p = this.worldToScreen(marker.pos);
      const t = marker.age / 0.4;
      ctx.strokeStyle = marker.attack ? COLORS.attackMarker : COLORS.marker;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + 10 * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const r = balance.dot.radius;
    this.drawGroundSpells(scene);
    for (const d of scene.dots) if (d.kind === "minion") this.drawMinion(d);
    for (const d of scene.dots) if (d.kind === "dot") this.drawDot(d, r);
    this.drawFlyingSpells(scene);
    for (const p of scene.projectiles) {
      const s = this.worldToScreen(p);
      ctx.fillStyle = COLORS.side[p.side]!;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.self;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const d of scene.dots) if (d.alive) this.drawHealthBar(d);

    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const n of scene.texts) {
      const s = this.worldToScreen(n);
      ctx.globalAlpha = Math.max(0, 1 - n.age / 0.9);
      ctx.fillStyle = n.color;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      const y = s.y - r - 18 - n.age * 40;
      ctx.strokeText(n.text, s.x, y);
      ctx.fillText(n.text, s.x, y);
    }
    ctx.globalAlpha = 1;

    const { mouse } = scene;
    if (mouse) {
      ctx.strokeStyle = COLORS.cursor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mouse.x - 8, mouse.y);
      ctx.lineTo(mouse.x + 8, mouse.y);
      ctx.moveTo(mouse.x, mouse.y - 8);
      ctx.lineTo(mouse.x, mouse.y + 8);
      ctx.stroke();
    }
  }

  private drawDot(d: DrawnDot, rBase: number): void {
    const { ctx } = this;
    const p = this.worldToScreen(d.pos);
    // In the air during a leap: a shadow below, the body a little bigger.
    const r = d.motion === "leap" ? rBase * 1.18 : rBase;
    if (d.motion === "leap") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + rBase * 0.6, rBase, rBase * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawStatusUnder(p, rBase, d.status);
    ctx.globalAlpha = d.inBrush || d.status.invisible ? 0.5 : 1;

    // Arms first, so the body overlaps their inner ends.
    const pose = armPose({ windUp: d.windUp, cast: d.cast, sinceRelease: d.sinceRelease, sinceCast: d.sinceCast });
    for (const mirror of [1, -1]) {
      const a = d.facing + mirror * pose.angle;
      const ax = p.x + Math.cos(a) * (r + 2);
      const ay = p.y + Math.sin(a) * (r + 2);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(d.facing);
      ctx.fillStyle = COLORS.side[d.side]!;
      ctx.strokeStyle = d.status.empowered ? "#ffb74d" : "rgba(0,0,0,0.35)";
      ctx.lineWidth = d.status.empowered ? 3 : 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.3 * pose.scale, r * 0.2 * pose.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = COLORS.side[d.side]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (d.isSelf || d.hovered) {
      ctx.strokeStyle = d.hovered ? COLORS.hover : COLORS.self;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    this.drawStatusOver(p, r, d);
    if (d.dummy) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("DUMMY", p.x, p.y + 4);
    }
    ctx.globalAlpha = 1;
  }

  /** Minions: small, darker than dots, no arms. Ranged ones have a hollow centre. A flash on each attack. */
  private drawMinion(d: DrawnDot): void {
    const { ctx } = this;
    const p = this.worldToScreen(d.pos);
    const r = d.radius;
    this.drawStatusUnder(p, r, d.status);
    ctx.globalAlpha = d.inBrush ? 0.5 : 1;
    ctx.fillStyle = COLORS.minion[d.side]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    const flash = d.sinceRelease !== null && d.sinceRelease >= 0 && d.sinceRelease < 0.12;
    ctx.strokeStyle = d.hovered ? COLORS.hover : flash ? "#ffffff" : "rgba(0,0,0,0.4)";
    ctx.lineWidth = d.hovered || flash ? 2 : 1;
    ctx.stroke();
    if (d.ranged) {
      ctx.fillStyle = COLORS.ground;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawStatusOver(p, r, d);
    ctx.globalAlpha = 1;
  }

  private drawStatusUnder(p: Vec, r: number, s: DotStatus): void {
    const { ctx } = this;
    if (s.rooted) {
      ctx.strokeStyle = COLORS.root;
      ctx.lineWidth = 5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (s.slowed) {
      ctx.fillStyle = "rgba(129,212,250,0.25)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 10, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.buffed) {
      ctx.fillStyle = "rgba(255,213,79,0.18)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStatusOver(p: Vec, r: number, d: DrawnDot): void {
    const { ctx } = this;
    const s = d.status;
    if (s.spellShield) {
      ctx.strokeStyle = COLORS.spellShield;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.barrier > 0) {
      ctx.strokeStyle = COLORS.barrier;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (s.stunned) {
      ctx.fillStyle = COLORS.stun;
      for (let i = 0; i < 3; i++) {
        const a = performance.now() / 300 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r * 0.7, p.y - r - 4 + Math.sin(a) * 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (d.channelling) {
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6 + 3 * Math.sin(performance.now() / 120), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.mark) {
      for (let i = 0; i < s.mark.of; i++) {
        ctx.fillStyle = i < s.mark.stacks ? "#ff7043" : "rgba(255,112,67,0.3)";
        ctx.beginPath();
        ctx.arc(p.x - (s.mark.of - 1) * 6 + i * 12, p.y - r - 22, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private spellColor(s: SpellSnapshot): string {
    const byAbility: Record<string, string> = {
      bolt: "#b388ff",
      piercer: "#ffab40",
      "snare-shot": "#69f0ae",
      boomerang: "#64ffda",
      "chill-field": "#81d4fa",
      artillery: "#ff8a65",
      burst: "#ea80fc",
      finisher: "#ff5252",
      leap: "#ffd180",
      shove: "#ffe57f",
    };
    return byAbility[s.ability] ?? COLORS.side[s.side]!;
  }

  /** Areas, domes and traps: under the dots. */
  private drawGroundSpells(scene: Scene): void {
    const { ctx } = this;
    for (const s of scene.spells) {
      const p = this.worldToScreen(s);
      const color = this.spellColor(s);
      if (s.kind === "area") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = s.armed ? 0.3 : 0.12;
        ctx.beginPath();
        // Before it goes off, a disc grows toward the edge: when it fills, it hits.
        ctx.arc(p.x, p.y, s.armed ? s.radius : s.radius * s.progress, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (s.kind === "zone") {
        ctx.fillStyle = COLORS.side[s.side]!;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = COLORS.side[s.side]!;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (s.kind === "trap") {
        ctx.strokeStyle = COLORS.root;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x - 10, p.y - 10);
        ctx.lineTo(p.x + 10, p.y + 10);
        ctx.moveTo(p.x + 10, p.y - 10);
        ctx.lineTo(p.x - 10, p.y + 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  /** Skillshots and hooks: over the dots. */
  private drawFlyingSpells(scene: Scene): void {
    const { ctx } = this;
    for (const s of scene.spells) {
      const p = this.worldToScreen(s);
      if (s.kind === "shot") {
        ctx.fillStyle = this.spellColor(s);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(6, s.width / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (s.kind === "hook") {
        const owner = scene.drawnAt.get(s.owner);
        if (owner) {
          const o = this.worldToScreen(owner);
          ctx.strokeStyle = COLORS.hook;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(o.x, o.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.fillStyle = COLORS.hook;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(7, s.width / 2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawHealthBar(d: DrawnDot): void {
    const { ctx } = this;
    const p = this.worldToScreen(d.pos);
    const r = d.radius;
    // Towers get a long bar, minions a thin one.
    const w = d.kind === "tower" ? 90 : r * 2;
    const h = d.kind === "minion" ? 3 : 5;
    const x = p.x - w / 2;
    const y = p.y - r - (d.kind === "minion" ? 8 : 12);
    ctx.fillStyle = COLORS.healthBack;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = COLORS.health[d.side]!;
    ctx.fillRect(x, y, w * Math.max(0, d.health / d.maxHealth), h);
  }
}
