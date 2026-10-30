// Label sizing and collision handling. Pure functions, no GPU state.
//
// Zoom maps world units to canvas pixels (what the projection in WebGPURenderer
// maps to the render target); `pixelRatio` is canvas pixels per CSS pixel.

// Sizes below are CSS pixels, i.e. what the user sees, so changing the render resolution
// changes sharpness but not label size. `pixelRatio` converts to canvas pixels.

/** Text size (em), in CSS px, at an apparent scale of 1; labels track the content while it's inside the clamp. */
export const LABEL_WORLD_EM = 14;
/** Smallest text we'll draw. Below this, labels stop shrinking and start being dropped by declutter(). */
export const LABEL_MIN_EM_PX = 9;
/** Largest text we'll draw, so zooming in doesn't make labels huge. */
export const LABEL_MAX_EM_PX = 18;
/** Size the atlas is rasterised at (canvas px); close to the largest size drawn to avoid blurry upscaling. */
export const LABEL_ATLAS_FONT_SIZE = 64;

/** Em size in canvas px for the given zoom: follows the content, clamped to a readable range on screen. */
export function labelEmPx(zoom: number, pixelRatio = 1): number {
  const css = Math.min(LABEL_MAX_EM_PX, Math.max(LABEL_MIN_EM_PX, (LABEL_WORLD_EM * zoom) / pixelRatio));
  return css * pixelRatio;
}

/** Multiplier from atlas pixels to world units for a label rasterised at `atlasFontSize`. */
export function labelWorldScale(zoom: number, pixelRatio = 1, atlasFontSize = LABEL_ATLAS_FONT_SIZE): number {
  return labelEmPx(zoom, pixelRatio) / atlasFontSize / zoom;
}

export interface LabelCandidate {
  id: string;
  /** Higher wins a collision. */
  priority: number;
  /** Centre and size in world units. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Greedy label placement: highest priority first, skipping any label whose
 * box overlaps one already accepted. Uses a spatial hash so it stays near
 * O(n) for large graphs. Ties keep input order, so output is stable frame to frame.
 */
export function declutter(candidates: LabelCandidate[], zoom: number, paddingPx = 4): Set<string> {
  const CELL = 128;
  const accepted = new Set<string>();
  const grid = new Map<string, { x0: number; y0: number; x1: number; y1: number }[]>();

  const order = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.priority - a.c.priority || a.i - b.i);

  for (const { c } of order) {
    // Glyph quads include vertical padding; collide on roughly the visible text height.
    const halfW = (c.width * zoom) / 2 + paddingPx;
    const halfH = (c.height * zoom * 0.6) / 2 + paddingPx;
    const box = { x0: c.x * zoom - halfW, y0: c.y * zoom - halfH, x1: c.x * zoom + halfW, y1: c.y * zoom + halfH };

    const cx0 = Math.floor(box.x0 / CELL), cx1 = Math.floor(box.x1 / CELL);
    const cy0 = Math.floor(box.y0 / CELL), cy1 = Math.floor(box.y1 / CELL);

    let blocked = false;
    for (let cx = cx0; cx <= cx1 && !blocked; cx++) {
      for (let cy = cy0; cy <= cy1 && !blocked; cy++) {
        for (const o of grid.get(`${cx},${cy}`) ?? []) {
          if (box.x0 < o.x1 && o.x0 < box.x1 && box.y0 < o.y1 && o.y0 < box.y1) { blocked = true; break; }
        }
      }
    }
    if (blocked) continue;

    accepted.add(c.id);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        const cell = grid.get(key);
        if (cell) cell.push(box); else grid.set(key, [box]);
      }
    }
  }
  return accepted;
}
