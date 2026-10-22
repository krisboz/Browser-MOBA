import type { BalanceData } from "@moba/balance";
import type { DotSnapshot, ProjectileSnapshot, Side } from "@moba/protocol";
import type { MapGeometry } from "@moba/sim";
import { armPose } from "./arms.js";

export interface Vec {
  x: number;
  y: number;
}

export interface ClickMarker {
  pos: Vec;
  age: number;
}

export interface FloatingNumber {
  x: number;
  y: number;
  amount: number;
  /** Seconds since it appeared. */
  age: number;
}

/** A dot as drawn: interpolated server state, with your own dot's position (and facing) from prediction. */
export interface DrawnDot {
  pos: Vec;
  side: Side;
  facing: number;
  health: number;
  maxHealth: number;
  windUp: number | null;
  sinceRelease: number | null;
  isSelf: boolean;
  inBrush: boolean;
  dummy: boolean;
  /** An enemy under the cursor: right click attacks it. */
  hovered: boolean;
}

export interface Scene {
  balance: BalanceData;
  geometry: MapGeometry;
  dots: DrawnDot[];
  projectiles: ProjectileSnapshot[];
  path: readonly Vec[];
  pathFrom: Vec | null;
  numbers: FloatingNumber[];
  marker: ClickMarker | null;
  mouse: Vec | null;
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
  self: "#ffffff",
  hover: "#ffd54f",
  healthBack: "rgba(0,0,0,0.55)",
  health: ["#7fd1ff", "#ff8a8a"],
  number: "#fff3c4",
  path: "rgba(159,232,112,0.35)",
  marker: "#9fe870",
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
      ctx.fillStyle = COLORS.wall;
      ctx.beginPath();
      ctx.arc(p.x, p.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.side[side]!;
      ctx.lineWidth = 4;
      ctx.stroke();
    });

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
      ctx.strokeStyle = COLORS.marker;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + 10 * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const r = balance.dot.radius;
    for (const d of scene.dots) this.drawDot(d, r);
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
    for (const d of scene.dots) this.drawHealthBar(d, r);

    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const n of scene.numbers) {
      const s = this.worldToScreen(n);
      ctx.globalAlpha = Math.max(0, 1 - n.age / 0.9);
      ctx.fillStyle = COLORS.number;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      const y = s.y - r - 18 - n.age * 40;
      ctx.strokeText(String(Math.round(n.amount)), s.x, y);
      ctx.fillText(String(Math.round(n.amount)), s.x, y);
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

  private drawDot(d: DrawnDot, r: number): void {
    const { ctx } = this;
    const p = this.worldToScreen(d.pos);
    ctx.globalAlpha = d.inBrush ? 0.55 : 1;

    // Arms first, so the body overlaps their inner ends.
    const pose = armPose(d.windUp, d.sinceRelease);
    for (const mirror of [1, -1]) {
      const a = d.facing + mirror * pose.angle;
      const ax = p.x + Math.cos(a) * (r + 2);
      const ay = p.y + Math.sin(a) * (r + 2);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(d.facing);
      ctx.fillStyle = COLORS.side[d.side]!;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
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
    if (d.dummy) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("DUMMY", p.x, p.y + 4);
    }
    ctx.globalAlpha = 1;
  }

  private drawHealthBar(d: DrawnDot, r: number): void {
    const { ctx } = this;
    const p = this.worldToScreen(d.pos);
    const w = r * 2;
    const x = p.x - r;
    const y = p.y - r - 12;
    ctx.fillStyle = COLORS.healthBack;
    ctx.fillRect(x - 1, y - 1, w + 2, 7);
    ctx.fillStyle = COLORS.health[d.side]!;
    ctx.fillRect(x, y, w * Math.max(0, d.health / d.maxHealth), 5);
  }
}
