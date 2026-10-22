import type { BalanceData } from "@moba/balance";

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** The static shape of a map: what blocks walking, where brush is, where each side spawns. */
export interface MapGeometry {
  length: number;
  width: number;
  walls: Rect[];
  /** Round obstacles: towers. */
  pillars: Circle[];
  brush: Rect[];
  spawns: [Vec, Vec];
  towers: [Vec, Vec];
}

export function buildGeometry(balance: BalanceData): MapGeometry {
  const { length, width, baseDepth, towerDistanceFromEnd, walls, brush } = balance.map;
  const towers: [Vec, Vec] = [
    { x: towerDistanceFromEnd, y: width / 2 },
    { x: length - towerDistanceFromEnd, y: width / 2 },
  ];
  return {
    length,
    width,
    walls,
    pillars: towers.map((t) => ({ ...t, r: balance.towers.radius })),
    brush,
    spawns: [
      { x: baseDepth / 2, y: width / 2 },
      { x: length - baseDepth / 2, y: width / 2 },
    ],
    towers,
  };
}

export const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

function closestOnRect(p: Vec, r: Rect): Vec {
  return { x: Math.min(Math.max(p.x, r.x), r.x + r.w), y: Math.min(Math.max(p.y, r.y), r.y + r.h) };
}

export function inRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

const TOLERANCE = 1e-6;

/** Whether a circle of radius `r` centred on `p` overlaps no wall, pillar or map edge. */
export function isClear(g: MapGeometry, p: Vec, r: number): boolean {
  if (p.x < r - TOLERANCE || p.y < r - TOLERANCE || p.x > g.length - r + TOLERANCE || p.y > g.width - r + TOLERANCE) return false;
  for (const w of g.walls) if (dist(p, closestOnRect(p, w)) < r - TOLERANCE) return false;
  for (const c of g.pillars) if (dist(p, c) < r + c.r - TOLERANCE) return false;
  return true;
}

// Fine enough that a dot can't clip a corner by more than a sliver between two samples.
const SEGMENT_STEP = 4;

/** Whether a circle of radius `r` can slide in a straight line from `a` to `b`. */
export function isSegmentClear(g: MapGeometry, a: Vec, b: Vec, r: number): boolean {
  const n = Math.max(1, Math.ceil(dist(a, b) / SEGMENT_STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isClear(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return false;
  }
  return true;
}

/** Moves `p` the shortest way out of anything it overlaps. The last step of movement, never the way to path. */
export function pushOut(g: MapGeometry, p: Vec, r: number): Vec {
  let q = { ...p };
  for (let iteration = 0; iteration < 4 && !isClear(g, q, r); iteration++) {
    for (const w of g.walls) {
      const c = closestOnRect(q, w);
      const d = dist(q, c);
      if (d >= r) continue;
      if (d > 1e-9) {
        q = { x: c.x + ((q.x - c.x) / d) * r, y: c.y + ((q.y - c.y) / d) * r };
      } else {
        // Centre inside the wall: leave through the nearest side.
        const exits = [
          { d: q.x - w.x, p: { x: w.x - r, y: q.y } },
          { d: w.x + w.w - q.x, p: { x: w.x + w.w + r, y: q.y } },
          { d: q.y - w.y, p: { x: q.x, y: w.y - r } },
          { d: w.y + w.h - q.y, p: { x: q.x, y: w.y + w.h + r } },
        ];
        const inBounds = exits.filter((e) => e.p.x >= r && e.p.y >= r && e.p.x <= g.length - r && e.p.y <= g.width - r);
        q = (inBounds.length ? inBounds : exits).reduce((best, e) => (e.d < best.d ? e : best)).p;
      }
    }
    for (const c of g.pillars) {
      const d = dist(q, c);
      const min = r + c.r;
      if (d >= min) continue;
      q = d > 1e-9 ? { x: c.x + ((q.x - c.x) / d) * min, y: c.y + ((q.y - c.y) / d) * min } : { x: c.x + min, y: c.y };
    }
    q = { x: Math.min(Math.max(q.x, r), g.length - r), y: Math.min(Math.max(q.y, r), g.width - r) };
  }
  return q;
}
