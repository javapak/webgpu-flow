// Timing for animated layout transitions. Pure functions, no React or GPU state.

import type { LayoutOptions, Point2D } from './graphLayout';

/** How long each node takes to travel to its new position. */
export const NODE_TRAVEL_MS = 600;
/** Upper bound on the spread of start times, so large graphs don't take ages to settle. */
export const MAX_STAGGER_MS = 400;
/** Start-time gap between consecutive nodes, before the cap above applies. */
const STAGGER_STEP_MS = 12;

/** Total time from the first node starting to the last one landing. */
export function transitionDuration(nodeCount: number): number {
  return NODE_TRAVEL_MS + Math.min(MAX_STAGGER_MS, Math.max(0, nodeCount - 1) * STAGGER_STEP_MS);
}

/**
 * Start delay per node, so the graph settles as a wave in the direction it flows:
 * left to right for a RIGHT-flowing layered layout, outward from the centre for
 * layouts without a direction (radial, force, stress, box).
 */
export function staggerDelays(targets: Map<string, Point2D>, options: LayoutOptions): Map<string, number> {
  const directed = options.algorithm === 'layered' || options.algorithm === 'tree';
  const points = [...targets.entries()];
  let cx = 0, cy = 0;
  for (const [, p] of points) { cx += p.x; cy += p.y; }
  cx /= points.length || 1; cy /= points.length || 1;

  const key = ({ x, y }: Point2D): number => {
    if (!directed) return Math.hypot(x - cx, y - cy);
    switch (options.direction) {
      case 'RIGHT': return x;
      case 'LEFT': return -x;
      case 'DOWN': return y;
      case 'UP': return -y;
    }
  };

  const ordered = points.sort((a, b) => key(a[1]) - key(b[1]));
  const spread = transitionDuration(ordered.length) - NODE_TRAVEL_MS;
  const delays = new Map<string, number>();
  ordered.forEach(([id], i) => delays.set(id, ordered.length > 1 ? (i / (ordered.length - 1)) * spread : 0));
  return delays;
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Eased progress (0..1) of a node `elapsed` ms into the transition. */
export function nodeProgress(elapsed: number, delay: number): number {
  return easeInOutCubic(Math.min(1, Math.max(0, (elapsed - delay) / NODE_TRAVEL_MS)));
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Morphs one edge's route into another for a layout transition. Both routes run from the
 * source's centre through the bend points to the target's centre. Each is sampled at its own
 * corners and the other's (by fraction of path length), so they have points in common to
 * interpolate between: the line starts exactly as the old route and lands exactly as the new
 * one, and an edge gaining or losing its routing unfolds rather than jumps. Returns the bend
 * points at progress `t` (0..1), without the two ends.
 */
export function morphRoute(from: Point2D[], to: Point2D[]): (t: number) => Point2D[] {
  const fractions = (path: Point2D[]): number[] => {
    const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
    const total = lengths.reduce((a, b) => a + b, 0);
    let run = 0;
    return [0, ...lengths.map(l => (run += l) / (total || 1))].map((f, i) => (total ? f : i / (path.length - 1)));
  };
  const at = (path: Point2D[], f: number[], u: number): Point2D => {
    let i = 1;
    while (i < f.length - 1 && f[i] < u) i++;
    const span = f[i] - f[i - 1];
    const s = span > 0 ? (u - f[i - 1]) / span : 0;
    return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * s, y: path[i - 1].y + (path[i].y - path[i - 1].y) * s };
  };

  const ff = fractions(from), ft = fractions(to);
  // The corners of both routes, as fractions of the way along; the ends aren't bend points.
  const shared = [...new Set([...ff, ...ft].map(u => Math.round(u * 1e6) / 1e6))]
    .filter(u => u > 0 && u < 1)
    .sort((a, b) => a - b);
  const a = shared.map(u => at(from, ff, u)), b = shared.map(u => at(to, ft, u));
  return t => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t }));
}
