import { dist, isClear, isSegmentClear, pushOut, type MapGeometry, type Vec } from "./geometry.js";

/** A grid over the map marking where a dot's centre can stand. Built once per balance version. */
export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private readonly free: Uint8Array;

  constructor(
    readonly geometry: MapGeometry,
    readonly radius: number,
  ) {
    this.cell = radius / 2;
    this.cols = Math.ceil(geometry.length / this.cell);
    this.rows = Math.ceil(geometry.width / this.cell);
    this.free = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.free.length; i++) this.free[i] = isClear(geometry, this.center(i), radius) ? 1 : 0;
  }

  center(i: number): Vec {
    return { x: ((i % this.cols) + 0.5) * this.cell, y: (Math.floor(i / this.cols) + 0.5) * this.cell };
  }

  isFree(i: number): boolean {
    return this.free[i] === 1;
  }

  nearestFreeCell(p: Vec): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.free.length; i++) {
      if (!this.free[i]) continue;
      const d = dist(p, this.center(i));
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  /** The closest point to `p` a dot can stand on. */
  nearestStandable(p: Vec): Vec {
    if (isClear(this.geometry, p, this.radius)) return { ...p };
    const pushed = pushOut(this.geometry, p, this.radius);
    if (isClear(this.geometry, pushed, this.radius)) return pushed;
    const i = this.nearestFreeCell(p);
    return i < 0 ? { ...p } : this.center(i);
  }
}

/**
 * Waypoints from `from` to (the standable point nearest) `to`, not including `from`.
 * A straight line when nothing is in the way; otherwise A* on the grid, smoothed into as few straight legs as possible.
 * Empty when there is no way there.
 */
export function findPath(nav: NavGrid, from: Vec, to: Vec): Vec[] {
  const g = nav.geometry;
  const r = nav.radius;
  const goal = nav.nearestStandable(to);
  if (isSegmentClear(g, from, goal, r)) return [goal];

  const start = nav.nearestFreeCell(from);
  const end = nav.nearestFreeCell(goal);
  if (start < 0 || end < 0) return [];
  const cells = aStar(nav, start, end);
  if (!cells) return [];

  const points = [from, ...cells.slice(1).map((i) => nav.center(i)), goal];
  // String pulling: from each corner, go as far down the cell path as a straight line allows.
  const path: Vec[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (j + 1 < points.length && isSegmentClear(g, points[i]!, points[j + 1]!, r)) j++;
    path.push(points[j]!);
    i = j;
  }
  return path;
}

const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
] as const;

function aStar(nav: NavGrid, start: number, end: number): number[] | null {
  const { cols, rows } = nav;
  const n = cols * rows;
  const cost = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const ex = end % cols;
  const ey = Math.floor(end / cols);
  const h = (i: number) => {
    const dx = Math.abs((i % cols) - ex);
    const dy = Math.abs(Math.floor(i / cols) - ey);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, h(start));
  while (open.size) {
    const cur = open.pop();
    if (cur === end) {
      const out = [cur];
      for (let c = from[cur]!; c >= 0; c = from[c]!) out.push(c);
      return out.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (const [dx, dy, step] of NEIGHBOURS) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const next = y * cols + x;
      if (!nav.isFree(next) || closed[next]) continue;
      // No cutting corners: a diagonal needs both sides open.
      if (dx && dy && (!nav.isFree(cy * cols + x) || !nav.isFree(y * cols + cx))) continue;
      const c = cost[cur]! + step;
      if (c < cost[next]!) {
        cost[next] = c;
        from[next] = cur;
        open.push(next, c + h(next));
      }
    }
  }
  return null;
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}
