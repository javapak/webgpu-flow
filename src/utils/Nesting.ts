/**
 * Nodes drawn inside other nodes. A node's `parentId` names the node it sits
 * in; that node is then a container: it is drawn behind its children, keeps a
 * header strip for its label, and carries them along when it moves.
 *
 * A node may also carry a compartment (`visual.compartment`): lines of text,
 * such as its properties, drawn under its header. They are not nodes: they
 * can't be selected, dragged or connected.
 *
 * A node with a header (a container, or a node with a compartment) is boxed:
 * header, then compartment, then children. Its body is a rectangle; a kind
 * whose shape isn't one shows that shape as the header's icon instead.
 *
 * A container arranges its children itself (arrangeContainers): in their
 * order in the node list, top to bottom, wrapping into further columns. A child
 * with `visual.presentation: 'row'` is drawn compactly, as an icon and a label
 * on one line the width of its column; any other child (typically a container
 * itself) keeps its box. A container's size follows from its children, so
 * neither it nor its children can be resized, and children have no positions
 * of their own to store.
 *
 * Everything here works on positions as the renderer has them (absolute
 * centres). Hosts that estimate container sizes themselves (arbor's adapter)
 * use the same constants; keep them in step.
 */
import type { DiagramNode } from '../types';

/** Space between a container's edge and its children. */
export const NEST_PADDING = 8;
/** Height of a container's header strip, above its children, which holds its label. */
export const NEST_HEADER = 28;
/** A row: its height, its width at the least, and the space between rows. */
export const ROW_HEIGHT = 26;
export const ROW_WIDTH = 180;
export const ROW_GAP = 4;
/** A column holds this many rows before the next one starts, unless a box makes it taller. */
export const ROWS_PER_COLUMN = 8;
export const COLUMN_GAP = 12;
/** A row's icon: its size, and the space around it. */
export const ROW_ICON = 16;
export const ROW_INSET = 6;
/** A compartment line's height, the estimated width of a character in it, and the space after the compartment. */
export const LINE_HEIGHT = 18;
export const CHAR_WIDTH = 7.5;
export const SECTION_GAP = 6;
/** Deeper nesting is drawn at this depth (see DepthConstants). */
export const MAX_NESTING = 12;

export interface Nesting {
  /** 0 for a top-level node, 1 inside one container, and so on. */
  depth(id: string): number;
  parent(id: string): DiagramNode | undefined;
  /** In the order of the node list. */
  children(id: string): DiagramNode[];
  /** Children, their children and so on, parents before children. */
  descendants(id: string): DiagramNode[];
  /** Whether the node is drawn as a container: it has children, or says it is one. */
  isContainer(node: DiagramNode): boolean;
}

const cache = new WeakMap<readonly DiagramNode[], Nesting>();

/** The nesting of a set of nodes. Cached per array, so pass the same array (e.g. the state's) to reuse it. */
export function nestingOf(nodes: readonly DiagramNode[]): Nesting {
  const cached = cache.get(nodes);
  if (cached) return cached;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const parentOf = (n: DiagramNode) => (n.parentId && n.parentId !== n.id ? byId.get(n.parentId) : undefined);
  const children = new Map<string, DiagramNode[]>();
  const depths = new Map<string, number>();

  const depth = (n: DiagramNode, seen = new Set<string>()): number => {
    const known = depths.get(n.id);
    if (known !== undefined) return known;
    const parent = parentOf(n);
    // A cycle of parentIds is broken by treating the node that closes it as top-level.
    const d = !parent || seen.has(parent.id) ? 0 : Math.min(MAX_NESTING, depth(parent, seen.add(n.id)) + 1);
    depths.set(n.id, d);
    return d;
  };
  for (const n of nodes) {
    depth(n);
    const parent = depths.get(n.id)! > 0 ? parentOf(n) : undefined;
    if (parent) (children.get(parent.id) ?? children.set(parent.id, []).get(parent.id)!).push(n);
  }

  const descendants = (id: string): DiagramNode[] =>
    (children.get(id) ?? []).flatMap(c => [c, ...descendants(c.id)]);

  const nesting: Nesting = {
    depth: id => depths.get(id) ?? 0,
    parent: id => {
      const n = byId.get(id);
      return n && depths.get(id)! > 0 ? parentOf(n) : undefined;
    },
    children: id => children.get(id) ?? [],
    descendants,
    isContainer: n => n.visual?.container === true || (children.get(n.id)?.length ?? 0) > 0,
  };
  cache.set(nodes, nesting);
  return nesting;
}

/** Whether the node is drawn as a row (see the top of this file). */
export function isRow(node: DiagramNode): boolean {
  return node.visual?.presentation === 'row';
}

/** The node's compartment lines (see the top of this file). */
export function compartmentOf(node: DiagramNode): string[] {
  const lines = node.visual?.compartment;
  return Array.isArray(lines) ? lines.filter((l): l is string => typeof l === 'string') : [];
}

/** Whether the node is boxed: drawn with a header (set by arrangeContainers). */
export function isBoxed(node: DiagramNode): boolean {
  return node.visual?.boxed === true;
}

/** Shapes a box can be drawn with; any other shape becomes the header's icon. */
const BOX_SHAPES = new Set(['rectangle', 'roundedRectangle', 'package']);
export const boxShapeOf = (shape: string | undefined) => (shape && BOX_SHAPES.has(shape) ? shape : 'roundedRectangle');

/** What a boxed node shows at the left of its header: its SVG/image/emoji, its shape, or nothing. */
export function headerIcon(node: DiagramNode): 'visual' | 'shape' | null {
  if (node.visual?.visualContent || node.visual?.icon || node.data?.emoji || node.data?.icon) return 'visual';
  const shape = node.visual?.shape;
  return shape && shape !== 'none' && !BOX_SHAPES.has(shape) ? 'shape' : null;
}

/** Where a boxed node's header icon (centre), compartment lines (left end, centres) and dividers are. */
export function boxLayout(node: DiagramNode): { icon: { x: number; y: number }; textLeft: number; lines: number[]; dividers: number[] } {
  const { x, y, width, height } = boxOf(node);
  const left = x - width / 2, top = y - height / 2;
  const lines = compartmentOf(node).map((_, i) => top + NEST_HEADER + NEST_PADDING + i * LINE_HEIGHT + LINE_HEIGHT / 2);
  const dividers = [top + NEST_HEADER];
  if (lines.length && node.visual?.boxedChildren) dividers.push(top + NEST_HEADER + NEST_PADDING + lines.length * LINE_HEIGHT + SECTION_GAP / 2);
  return { icon: { x: left + NEST_HEADER / 2, y: top + NEST_HEADER / 2 }, textLeft: left + NEST_PADDING + ROW_INSET, lines, dividers };
}

export interface Box { x: number; y: number; width: number; height: number }

export function boxOf(node: DiagramNode): Box {
  const size = node.visual?.size ?? node.data.size ?? { width: 100, height: 60 };
  return { x: node.data.position.x, y: node.data.position.y, width: size.width, height: size.height };
}

/** Sets a node's box, keeping `data.size` in step where the node has one (as resizing does). */
export function setBox(node: DiagramNode, box: Box): void {
  node.data.position = { x: box.x, y: box.y };
  node.visual = { ...node.visual, size: { width: box.width, height: box.height } };
  if (node.data.size) node.data.size = { width: box.width, height: box.height };
}

type Size = { width: number; height: number };

/**
 * Arranges every boxed node: its compartment under its header, its children
 * under that, and its size to hold them (at least its own width, for a
 * top-level node). Keeps each top-level node's centre where it is or, given a
 * `grid` size, puts its edges on the nearest grid lines. Updates the nodes in
 * place.
 */
export function arrangeContainers(nodes: readonly DiagramNode[], grid?: number): void {
  const nesting = nestingOf(nodes);
  const sizes = new Map<string, Size>();
  const columns = new Map<string, DiagramNode[][]>();
  const boxed = (node: DiagramNode) => !isRow(node) && (nesting.isContainer(node) || compartmentOf(node).length > 0);

  // Sizes, deepest first.
  const measure = (node: DiagramNode): Size => {
    const known = sizes.get(node.id);
    if (known) return known;
    const kids = nesting.children(node.id);
    const lines = compartmentOf(node);
    let size: Size;
    if (boxed(node)) {
      const cols = kids.length ? columnsOf(kids, measure) : [];
      if (cols.length) columns.set(node.id, cols);
      const extent = cols.length ? extentOf(cols, measure) : { width: 0, height: 0 };
      const text = lines.length ? lines.length * LINE_HEIGHT + (cols.length ? SECTION_GAP : 0) : 0;
      const textWidth = Math.max(0, ...lines.map(l => l.length * CHAR_WIDTH + 2 * ROW_INSET));
      const own = nesting.parent(node.id) ? 0 : boxOf(node).width;
      size = {
        width: Math.max(own, Math.max(kids.length ? ROW_WIDTH : 0, extent.width, textWidth) + 2 * NEST_PADDING),
        height: NEST_HEADER + text + extent.height + (text || extent.height ? 2 * NEST_PADDING : 0),
      };
    } else if (isRow(node) && nesting.parent(node.id)) {
      size = { width: ROW_WIDTH, height: ROW_HEIGHT };
    } else {
      const own = boxOf(node);
      size = { width: own.width, height: own.height };
    }
    sizes.set(node.id, size);
    return size;
  };

  // Positions, top-down: columns from the box's top-left, below the header and compartment.
  const place = (node: DiagramNode, x: number, y: number, width: number) => {
    const size = sizes.get(node.id)!;
    setBox(node, { x, y, width, height: size.height });
    const cols = columns.get(node.id);
    if (boxed(node) || nesting.parent(node.id)) {
      node.visual = { ...node.visual, resizable: false, ...(boxed(node) ? { boxed: true, boxedChildren: !!cols } : {}) };
    }
    if (!cols) return;
    const lines = compartmentOf(node).length;
    let left = x - width / 2 + NEST_PADDING;
    const top = y - size.height / 2 + NEST_HEADER + NEST_PADDING + (lines ? lines * LINE_HEIGHT + SECTION_GAP : 0);
    // The columns share whatever width the box has beyond them (its own width, a long property
    // line, or a stretched box), so its children reach its inner edges.
    const widths = cols.map(col => Math.max(ROW_WIDTH, ...col.map(c => measure(c).width)));
    const spare = Math.max(0, width - 2 * NEST_PADDING - extentOf(cols, measure).width) / cols.length;
    cols.forEach((col, i) => {
      const colWidth = widths[i] + spare;
      let at = top;
      for (const child of col) {
        // Rows and boxes alike take the column's width.
        const h = measure(child).height;
        place(child, left + colWidth / 2, at + h / 2, colWidth);
        at += h + ROW_GAP;
      }
      left += colWidth + COLUMN_GAP;
    });
  };

  for (const node of nodes) {
    if (nesting.depth(node.id) > 0 || !boxed(node)) continue;
    let { x, y } = node.data.position;
    let size = measure(node);
    if (grid) {
      // Its size can't be set by hand, so put its edges on grid lines: whole grid steps, corner on the grid.
      size = { width: Math.ceil(size.width / grid) * grid, height: Math.ceil(size.height / grid) * grid };
      sizes.set(node.id, size);
      x = Math.round((x - size.width / 2) / grid) * grid + size.width / 2;
      y = Math.round((y - size.height / 2) / grid) * grid + size.height / 2;
    }
    place(node, x, y, size.width);
  }
}

/** Splits children into columns: ROWS_PER_COLUMN rows high, or as high as the tallest box. */
function columnsOf(kids: DiagramNode[], measure: (n: DiagramNode) => Size): DiagramNode[][] {
  const rowsHigh = ROWS_PER_COLUMN * ROW_HEIGHT + (ROWS_PER_COLUMN - 1) * ROW_GAP;
  const limit = Math.max(rowsHigh, ...kids.map(k => measure(k).height));
  const cols: DiagramNode[][] = [[]];
  let height = 0;
  for (const kid of kids) {
    const h = measure(kid).height;
    const col = cols[cols.length - 1];
    if (col.length > 0 && height + ROW_GAP + h > limit) {
      cols.push([kid]);
      height = h;
    } else {
      height += (col.length > 0 ? ROW_GAP : 0) + h;
      col.push(kid);
    }
  }
  return cols;
}

function extentOf(cols: DiagramNode[][], measure: (n: DiagramNode) => Size): Size {
  const widths = cols.map(col => Math.max(ROW_WIDTH, ...col.map(c => measure(c).width)));
  const heights = cols.map(col => col.reduce((h, c, i) => h + (i ? ROW_GAP : 0) + measure(c).height, 0));
  return {
    width: widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (cols.length - 1),
    height: Math.max(...heights),
  };
}

/** Where a row draws its icon (centre) and where its label starts and its detail ends. */
export function rowLayout(node: DiagramNode): { icon: { x: number; y: number }; labelLeft: number; detailRight: number } {
  const { x, y, width } = boxOf(node);
  const left = x - width / 2;
  return {
    icon: { x: left + ROW_INSET + ROW_ICON / 2, y },
    labelLeft: left + 2 * ROW_INSET + ROW_ICON,
    detailRight: x + width / 2 - ROW_INSET,
  };
}
