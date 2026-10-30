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
