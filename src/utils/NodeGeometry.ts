/**
 * Where a node's outline is. One definition serves the resize handles, the
 * points where edges meet the node, and the edge markers, so all three sit on
 * what is actually drawn.
 *
 * Shapes mirror the signed distance functions in WebGPURenderer's node shader;
 * keep them in step. A node drawn by its SVG or image content alone (shape
 * 'none') uses the content's alpha mask, which the visual atlas records when
 * it rasterises the content.
 */
import type { DiagramNode } from '../types';
import type { ResizeHandle } from './MouseInteractions';

type Point = { x: number; y: number };

/** A content raster's coverage, row 0 at the top. */
export interface AlphaMask { width: number; height: number; alpha: Uint8Array }

type VisualContent = NonNullable<NonNullable<DiagramNode['visual']>['visualContent']>;

const masks = new Map<string, AlphaMask>();
const maskKey = (c: VisualContent) => `${c.type}\u0000${c.size?.width ?? 64}\u0000${c.content}`;

/** Records the alpha mask of rasterised content, for nodes drawn by that content. */
export function setContentMask(content: VisualContent, mask: AlphaMask): void {
  masks.set(maskKey(content), mask);
}

/** Inside test in node-local coordinates: -1..1 across the node's box, +y down. */
type Inside = (u: number, v: number) => boolean;

const MARCH_STEPS = 64;
const BISECT_STEPS = 10;

/**
 * Where a ray from the node's centre in `direction` (world units, any length)
 * leaves the node's outline. Marches inward from the box edge, so hollow
 * content (an outline icon, a ring) gives its outer edge.
 */
export function boundaryPoint(node: DiagramNode, direction: Point): Point {
  const center = node.data.position;
  const { width, height } = sizeOf(node);
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0 || width <= 0 || height <= 0) return { ...center };
  const dx = direction.x / length, dy = direction.y / length;
  const hw = width / 2, hh = height / 2;
  // Distance to the box edge along the ray.
  const exit = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  const at = (t: number) => ({ x: center.x + dx * t, y: center.y + dy * t });

  const inside = insideTest(node);
  if (!inside) return at(exit);
  const hit = (t: number) => inside((dx * t) / hw, (dy * t) / hh);

  const step = exit / MARCH_STEPS;
  for (let i = 0; i < MARCH_STEPS; i++) {
    let outer = exit - i * step;
    let inner = outer - step;
    if (!hit(inner)) continue;
    for (let j = 0; j < BISECT_STEPS; j++) {
      const mid = (outer + inner) / 2;
      if (hit(mid)) inner = mid; else outer = mid;
    }
    return at(inner);
  }
  return at(exit);   // nothing drawn along this ray
}

/** The 8 directions handles sit in; corners point at the box's corners. */
const HANDLE_DIRECTIONS: Array<{ handle: Exclude<ResizeHandle, 'none'>; sx: number; sy: number }> = [
  { handle: 'nw', sx: -1, sy: -1 }, { handle: 'n', sx: 0, sy: -1 }, { handle: 'ne', sx: 1, sy: -1 },
  { handle: 'e', sx: 1, sy: 0 }, { handle: 'se', sx: 1, sy: 1 }, { handle: 's', sx: 0, sy: 1 },
  { handle: 'sw', sx: -1, sy: 1 }, { handle: 'w', sx: -1, sy: 0 },
];

/** Resize handles on the node's outline, one per direction. */
export function resizeHandles(node: DiagramNode): Array<{ handle: Exclude<ResizeHandle, 'none'>; x: number; y: number }> {
  const { width, height } = sizeOf(node);
  return HANDLE_DIRECTIONS.map(({ handle, sx, sy }) => ({
    handle,
    ...boundaryPoint(node, { x: (sx * width) / 2, y: (sy * height) / 2 }),
  }));
}

function sizeOf(node: DiagramNode): { width: number; height: number } {
  return node.visual?.size ?? node.data.size ?? { width: 100, height: 60 };
}

/** The node's inside test, or null when it fills its box. */
function insideTest(node: DiagramNode): Inside | null {
  const shape = node.visual?.shape ?? 'rectangle';
  if (shape === 'none') {
    const content = node.visual?.visualContent;
    const mask = content && masks.get(maskKey(content));
    return mask ? insideMask(mask) : null;
  }
  const { width, height } = sizeOf(node);
  const aspect = width / height;
  // The shader draws on a quad covering the box; nothing outside it shows.
  return (u, v) => Math.abs(u) <= 1 && Math.abs(v) <= 1 && shapeDistance(shape, u, v, aspect) < 0;
}

function insideMask(mask: AlphaMask): Inside {
  return (u, v) => {
    const x = Math.floor(((u + 1) / 2) * mask.width);
    const y = Math.floor(((v + 1) / 2) * mask.height);
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
    return mask.alpha[y * mask.width + x] >= 128;
  };
}

// ---------------------------------------------------------------- shader port
// `p` is in units of half the node's height (x stretched by the aspect ratio),
// `q` (the shader's p_square) ignores the aspect ratio. Same cases, same constants.

function shapeDistance(shape: string, u: number, v: number, aspect: number): number {
  const px = u * aspect, py = v;
  switch (shape) {
    case 'circle':
    case 'initialNode':
      return sdCircle(u, v, 0.95);
    case 'finalNode':
      return Math.max(sdCircle(u, v, 0.95), -sdCircle(u, v, 0.7));
    case 'diamond':
      return sdDiamond(u, v, 0.95);
    case 'hexagon':
      return sdHexagon(u, v, 0.9 * Math.sqrt(aspect));
    case 'package':
      return Math.min(
        sdRoundedRectangle(px, py, aspect * 0.85, 0.75, 0.1),
        sdRectangle(px, py + 0.85, aspect * 0.4, 0.1),
      );
    case 'roundedRectangle':
      return sdRoundedRectangle(px, py, aspect * 0.95, 0.95, 0.1);
    case 'oval':
      return (px * px) / (aspect * 0.95) ** 2 + (py * py) / 0.85 ** 2 - 1;
    case 'actor':
      return Math.min(sdCircle(u, v + 0.4, 0.2), sdRectangle(u, v + 0.1, 0.15, 0.4));
    default:
      return sdRectangle(px, py, aspect * 0.95, 0.95);
  }
}

function sdRectangle(x: number, y: number, bx: number, by: number): number {
  const dx = Math.abs(x) - bx, dy = Math.abs(y) - by;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

function sdCircle(x: number, y: number, r: number): number {
  return Math.hypot(x, y) - r;
}

function sdDiamond(x: number, y: number, h: number): number {
  return (Math.abs(x) + Math.abs(y) - h) / Math.SQRT2;
}

function sdHexagon(x: number, y: number, r: number): number {
  const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
  const qx = Math.abs(x), qy = Math.abs(y);
  const d = 2 * Math.min(qx * kx + qy * ky, 0);
  const q2x = qx - d * kx, q2y = qy - d * ky;
  const q3x = q2x - Math.min(Math.max(q2x, -kz * r), kz * r), q3y = q2y - r;
  return Math.hypot(q3x, q3y) * Math.sign(q3y);
}

function sdRoundedRectangle(x: number, y: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
