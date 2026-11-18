/**
 * Orthogonal edge routing around nodes, for layouts that place nodes without
 * routing edges (every algorithm but layered, and edges into containers).
 *
 * A* over a sparse grid: candidate lines run along every node's sides, a
 * margin out, through every node's centre, and midway between neighbouring
 * lines, so paths keep to the channels between nodes. A path may not cross a
 * node other than its ends and the containers around them (see utils/Nesting).
 * Each bend costs extra, and so does running along a stretch an earlier edge
 * already uses, so parallel edges spread out instead of sharing a line.
 *
 * Paths start and end at node centres and leave a node along its centre lines
 * (a row, only sideways), so the renderer, which draws an edge from the node's
 * outline towards its first bend point, keeps the first and last segments
 * straight. The returned bend points are those outside the end nodes.
 */
type Point = { x: number; y: number };

export interface RouteNode {
  id: string;
  /** Centre and size. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The container it is drawn in. */
  parentId?: string;
  /** Rows are left and entered sideways only. */
  row?: boolean;
}

export interface RouteEdge { id: string; source: string; target: string }

const MARGIN = 14;
const BEND_COST = 40;
/** Extra cost per edge already on a stretch, as a share of its length. */
const SHARED_COST = 0.6;
/** Beyond this many grid lines per axis, routing would be slow; edges stay straight. */
const MAX_LINES = 600;

export function routeEdges(nodes: RouteNode[], edges: RouteEdge[]): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  const byId = new Map(nodes.map(n => [n.id, n]));
  const box = (n: RouteNode, m = 0) => ({
    l: n.x - n.width / 2 - m, r: n.x + n.width / 2 + m, t: n.y - n.height / 2 - m, b: n.y + n.height / 2 + m,
  });

  // Candidate lines, with midpoints between neighbours so paths can run down the middle of a channel.
  const lines = (values: number[]) => {
    const sorted = [...new Set(values.map(v => Math.round(v * 2) / 2))].sort((a, b) => a - b);
    const all = sorted.flatMap((v, i) => (i ? [(sorted[i - 1] + v) / 2, v] : [v]));
    return [...new Set(all)].sort((a, b) => a - b);
  };
  const X = lines(nodes.flatMap(n => { const b = box(n, MARGIN); return [b.l, b.r, n.x]; }));
  const Y = lines(nodes.flatMap(n => { const b = box(n, MARGIN); return [b.t, b.b, n.y]; }));
  if (X.length > MAX_LINES || Y.length > MAX_LINES) return routes;
  const nx = X.length;
  const xIndex = new Map(X.map((v, i) => [v, i])), yIndex = new Map(Y.map((v, i) => [v, i]));
  const at = (v: number, index: Map<number, number>) => index.get(Math.round(v * 2) / 2);

  // Which nodes (by index) cover each grid segment: its midpoint is strictly inside the node plus margin.
  // Segment keys: 2 * point for the one to the right of a point, 2 * point + 1 for the one below it.
  const covered = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const b = box(n, MARGIN);
    for (let iy = 0; iy < Y.length; iy++) {
      if (Y[iy] < b.t || Y[iy] > b.b) continue;
      for (let ix = 0; ix < nx; ix++) {
        if (X[ix] < b.l || X[ix] > b.r) continue;
        const point = iy * nx + ix;
        if (ix + 1 < nx) {
          const mx = (X[ix] + X[ix + 1]) / 2;
          if (mx > b.l && mx < b.r && Y[iy] > b.t && Y[iy] < b.b) (covered.get(2 * point) ?? covered.set(2 * point, []).get(2 * point)!).push(i);
        }
        if (iy + 1 < Y.length) {
          const my = (Y[iy] + Y[iy + 1]) / 2;
          if (my > b.t && my < b.b && X[ix] > b.l && X[ix] < b.r) (covered.get(2 * point + 1) ?? covered.set(2 * point + 1, []).get(2 * point + 1)!).push(i);
        }
      }
    }
  });

  const used = new Map<number, number>();
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const ancestors = (id: string) => {
    const out: string[] = [];
    for (let p = byId.get(id)?.parentId; p && byId.has(p) && !out.includes(p); p = byId.get(p)!.parentId) out.push(p);
    return out;
  };

  for (const edge of edges) {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target || source === target) continue;
    const sx = at(source.x, xIndex), sy = at(source.y, yIndex), tx = at(target.x, xIndex), ty = at(target.y, yIndex);
    if (sx === undefined || sy === undefined || tx === undefined || ty === undefined) continue;
    const free = new Set([edge.source, edge.target, ...ancestors(edge.source), ...ancestors(edge.target)].map(id => index.get(id)!));

    // Inside an end node, only its centre lines (a row's horizontal one) may be used.
    const ends = [source, target].map(n => ({ n, b: box(n), cx: X[at(n.x, xIndex)!], cy: Y[at(n.y, yIndex)!] }));
    const allowed = (horizontal: boolean, x: number, y: number) => {
      for (const { n, b, cx, cy } of ends) {
        if (x <= b.l || x >= b.r || y <= b.t || y >= b.b) continue;
        if (horizontal ? y !== cy : n.row || x !== cx) return false;
      }
      return true;
    };

    const path = search(sy * nx + sx, ty * nx + tx, nx, X, Y, (key, horizontal, mid) => {
      const covering = covered.get(key);
      if (covering?.some(i => !free.has(i))) return Infinity;
      if (!allowed(horizontal, mid.x, mid.y)) return Infinity;
      return 1 + SHARED_COST * (used.get(key) ?? 0);
    });
    if (!path) continue;

    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const key = Math.abs(a - b) === 1 ? 2 * Math.min(a, b) : 2 * Math.min(a, b) + 1;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
    const points = corners(path.map(p => ({ x: X[p % nx], y: Y[Math.floor(p / nx)] })));
    const sb = box(source), tb = box(target);
    const inside = (p: Point, b: ReturnType<typeof box>) => p.x >= b.l && p.x <= b.r && p.y >= b.t && p.y <= b.b;
    routes.set(edge.id, points.slice(1, -1).filter(p => !inside(p, sb) && !inside(p, tb)));
  }
  return routes;
}

/** The points where the path turns, with its ends. */
function corners(points: Point[]): Point[] {
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1], b = points[i + 1];
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

/**
 * A* from grid point `start` to `goal`. `cost(segment, horizontal, midpoint)` is the cost per unit
 * length of a segment (Infinity when blocked); turning adds BEND_COST. Returns grid points, or null.
 */
function search(
  start: number, goal: number, nx: number, X: number[], Y: number[],
  cost: (key: number, horizontal: boolean, mid: Point) => number,
): number[] | null {
  const ny = Y.length;
  const xy = (p: number) => ({ x: X[p % nx], y: Y[Math.floor(p / nx)] });
  const g = xy(goal);
  const h = (p: number) => { const q = xy(p); return Math.abs(q.x - g.x) + Math.abs(q.y - g.y); };
  // States are point * 3 + heading (0 start, 1 horizontal, 2 vertical).
  const best = new Map<number, number>();
  const from = new Map<number, number>();
  const heap = new Heap();
  best.set(start * 3, 0);
  heap.push(start * 3, h(start));

  while (heap.size) {
    const state = heap.pop();
    const p = Math.floor(state / 3), heading = state % 3;
    if (p === goal) {
      const out = [p];
      for (let s = state; from.has(s); ) { s = from.get(s)!; out.push(Math.floor(s / 3)); }
      return out.reverse();
    }
    const done = best.get(state)!;
    const ix = p % nx, iy = Math.floor(p / nx);
    const moves: Array<[number, boolean, number]> = [];   // [next point, horizontal, segment key]
    if (ix + 1 < nx) moves.push([p + 1, true, 2 * p]);
    if (ix > 0) moves.push([p - 1, true, 2 * (p - 1)]);
    if (iy + 1 < ny) moves.push([p + nx, false, 2 * p + 1]);
    if (iy > 0) moves.push([p - nx, false, 2 * (p - nx) + 1]);
    for (const [q, horizontal, key] of moves) {
      const a = xy(p), b = xy(q);
      const unit = cost(key, horizontal, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (unit === Infinity) continue;
      const next = horizontal ? 1 : 2;
      const total = done + unit * (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) + (heading && heading !== next ? BEND_COST : 0);
      const s = q * 3 + next;
      if (total >= (best.get(s) ?? Infinity)) continue;
      best.set(s, total);
      from.set(s, state);
      heap.push(s, total + h(q));
    }
  }
  return null;
}

/** A binary min-heap of states by priority. */
class Heap {
  private items: Array<[number, number]> = [];
  get size() { return this.items.length; }
  push(state: number, priority: number) {
    const items = this.items;
    items.push([state, priority]);
    for (let i = items.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (items[parent][1] <= items[i][1]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0][0];
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < items.length && items[l][1] < items[m][1]) m = l;
        if (r < items.length && items[r][1] < items[m][1]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}
