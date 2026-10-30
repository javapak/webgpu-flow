// Coordinate math shared by the canvas input handlers and the provider.
//
// Three spaces are involved:
//   client - CSS pixels in the page (PointerEvent.clientX/Y)
//   canvas - pixels of the canvas backing store (canvas.width x canvas.height)
//   world  - diagram units; the viewport centre sits in the middle of the canvas
//
// Everything here is pure so it can be tested without a DOM or GPU.

export interface Point { x: number; y: number }
export interface View { x: number; y: number; zoom: number }
export interface Size { width: number; height: number }
export interface ClientRect { left: number; top: number; width: number; height: number }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Largest box with the given aspect ratio that fits inside the container. */
export function fitContain(container: Size, aspect: number): Size {
  if (container.width <= 0 || container.height <= 0 || aspect <= 0) return { width: 0, height: 0 };
  const width = Math.min(container.width, container.height * aspect);
  return { width: Math.floor(width), height: Math.floor(width / aspect) };
}

export function clientToCanvas(rect: ClientRect, canvas: Size, clientX: number, clientY: number): Point {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) * canvas.width) / rect.width,
    y: ((clientY - rect.top) * canvas.height) / rect.height,
  };
}

export function canvasToWorld(view: View, canvas: Size, p: Point): Point {
  return {
    x: (p.x - canvas.width / 2) / view.zoom + view.x,
    y: (p.y - canvas.height / 2) / view.zoom + view.y,
  };
}

export function worldToCanvas(view: View, canvas: Size, p: Point): Point {
  return {
    x: (p.x - view.x) * view.zoom + canvas.width / 2,
    y: (p.y - view.y) * view.zoom + canvas.height / 2,
  };
}

/** New view at `zoom` that keeps the world point under `anchor` (canvas px) fixed. */
export function zoomAbout(view: View, canvas: Size, anchor: Point, zoom: number): View {
  const next = clampZoom(zoom);
  const world = canvasToWorld(view, canvas, anchor);
  return {
    zoom: next,
    x: world.x - (anchor.x - canvas.width / 2) / next,
    y: world.y - (anchor.y - canvas.height / 2) / next,
  };
}

/**
 * Multiplicative zoom for a wheel event. Exponential in the delta so a
 * trackpad's stream of small events and a mouse wheel's big steps both feel
 * proportional. Pinch gestures arrive as ctrl+wheel with much smaller deltas.
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1; // lines/pages -> pixels
  // Cap per-event delta so one notched wheel click is a modest step, not a jump.
  const delta = Math.max(-100, Math.min(100, e.deltaY * lines));
  return Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
}

/**
 * View after a two-finger gesture: the world points that were under the
 * fingers at the start stay under them (pan + zoom + keeps the pinch centre fixed).
 */
export function pinchView(start: View, canvas: Size, startCenter: Point, startDistance: number, center: Point, distance: number): View {
  const zoom = clampZoom(start.zoom * (distance / Math.max(startDistance, 1e-6)));
  const world = canvasToWorld(start, canvas, startCenter);
  return {
    zoom,
    x: world.x - (center.x - canvas.width / 2) / zoom,
    y: world.y - (center.y - canvas.height / 2) / zoom,
  };
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Handle squares are ~12 CSS px; below this on-screen size they'd crowd the node and swallow clicks on its neighbours. */
export const MIN_RESIZABLE_NODE_PX = 36;

/** Whether a node of `size` is large enough, at `zoom`, to offer resize handles. */
export const canShowResizeHandles = (size: Size, zoom: number, pixelRatio = 1) =>
  Math.min(size.width, size.height) * zoom >= MIN_RESIZABLE_NODE_PX * pixelRatio;
