import type { BalanceData } from "@moba/balance";
import type { DotSnapshot, Side } from "@moba/protocol";
import type { MapGeometry } from "@moba/sim";

export interface Vec {
  x: number;
  y: number;
}

export interface ClickMarker {
  pos: Vec;
  age: number;
}

export interface Scene {
  balance: BalanceData;
  geometry: MapGeometry;
  others: DotSnapshot[];
  self: { pos: Vec; side: Side; path: readonly Vec[]; inBrush: boolean } | null;
  marker: ClickMarker | null;
  mouse: Vec | null;
}

const COLORS = {
  ground: "#1b2a1f",
  lane: "#2d3b2f",
  base: ["#1d3557", "#5a1d1d"],
  wall: "#4a4f57",
  brush: "#1f4d2b",
  grid: "rgba(255,255,255,0.04)",
  side: ["#4ea8ff", "#ff5d5d"],
  self: "#ffffff",
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

    const { self, marker } = scene;
    if (self?.path.length) {
      ctx.strokeStyle = COLORS.path;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      const start = this.worldToScreen(self.pos);
      ctx.moveTo(start.x, start.y);
      for (const w of self.path) {
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
    for (const d of scene.others) this.drawDot(d, d.side, r, false, false);
    if (self) this.drawDot(self.pos, self.side, r, true, self.inBrush);

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

  private drawDot(pos: Vec, side: Side, r: number, isSelf: boolean, faded: boolean): void {
    const { ctx } = this;
    const p = this.worldToScreen(pos);
    ctx.globalAlpha = faded ? 0.55 : 1;
    ctx.fillStyle = COLORS.side[side]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (isSelf) {
      ctx.strokeStyle = COLORS.self;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
