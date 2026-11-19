import ELK, { type ElkNode, type ElkExtendedEdge, type LayoutOptions as ElkOptions } from 'elkjs/lib/elk-api';
import type { DiagramNode, DiagramEdge } from '../types';
import { nestingOf } from '../utils/Nesting';
import { routeEdges, type RouteNode } from './edgeRouter';

export type LayoutAlgorithm = 'layered' | 'tree' | 'radial' | 'stress' | 'force' | 'box';
export type LayoutDirection = 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
// STRAIGHT discards routing and draws edges centre-to-centre.
export type EdgeRouting = 'ORTHOGONAL' | 'POLYLINE' | 'STRAIGHT';

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  /** Only used by layered and tree. */
  direction: LayoutDirection;
  /** Only used by layered; the other algorithms don't route edges. */
  edgeRouting: EdgeRouting;
  /** Multiplier on the base node/layer spacing. */
  spacing: number;
  /**
   * Snap grid, in world units: each node's top-left corner lands on it (nested nodes move with
   * their container), and nodes keep at least a cell apart so snapping can't make them touch.
   */
  grid?: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  algorithm: 'layered',
  direction: 'RIGHT',
  edgeRouting: 'ORTHOGONAL',
  spacing: 1,
};

export interface Point2D { x: number; y: number }

export interface LayoutResult {
  /** Node centres, in the coordinate space of DiagramNode.data.position. */
  positions: Map<string, Point2D>;
  /** Intermediate vertices per edge id, in the coordinate space of DiagramEdge.userVertices. */
  edgeVertices: Map<string, Point2D[]>;
}

const NODE_GAP = 70;
const LAYER_GAP = 220;
const COMPONENT_GAP = 200;

// Created lazily so importing this module (e.g. from tests) doesn't spawn a worker.
let elk: InstanceType<typeof ELK> | null = null;
// ELK's worker as Vite bundles it.
let workerFactory = () => new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url));
const getElk = () => (elk ??= new ELK({ workerFactory: () => workerFactory() }));

/**
 * Where layouts run, for hosts that don't bundle with Vite or only allow some
 * workers (a VS Code webview allows `blob:` ones): a factory for a worker
 * running elkjs/lib/elk-worker.min.js. Takes effect from the next layout.
 */
export function setLayoutWorker(factory: () => Worker): void {
  workerFactory = factory;
  elk?.terminateWorker();
  elk = null;
}

const ALGORITHM_IDS: Record<LayoutAlgorithm, string> = {
  layered: 'layered',
  tree: 'mrtree',
  radial: 'radial', // unused: see layoutRadial
  stress: 'stress',
  force: 'force',
  box: 'rectpacking',
};

/** Least room between nodes: the spacing's, and at least a grid cell (snapping moves each node up to half of one). */
function nodeGap(o: LayoutOptions): number {
  return Math.max(NODE_GAP * o.spacing, o.grid ?? 0);
}

/** Moves each node so its top-left corner is on the grid. */
function snapToGrid(positions: Map<string, Point2D>, sizes: Map<string, Size>, grid: number): Map<string, Point2D> {
  const snap = (v: number) => Math.round(v / grid) * grid;
  return new Map([...positions].map(([id, p]) => {
    const { width, height } = sizes.get(id)!;
    return [id, { x: snap(p.x - width / 2) + width / 2, y: snap(p.y - height / 2) + height / 2 }];
  }));
}

function buildElkOptions(o: LayoutOptions): ElkOptions {
  const node = String(nodeGap(o));
  const layer = String(LAYER_GAP * o.spacing);

  const common: ElkOptions = {
    'elk.algorithm': ALGORITHM_IDS[o.algorithm],
    'elk.spacing.nodeNode': node,
    'elk.spacing.componentComponent': String(COMPONENT_GAP * o.spacing),
    'elk.separateConnectedComponents': 'true',
    // Stable output for the same input.
    'elk.randomSeed': '1',
  };

  switch (o.algorithm) {
    case 'layered':
      return {
        ...common,
        'elk.direction': o.direction,
        'elk.edgeRouting': o.edgeRouting === 'ORTHOGONAL' ? 'ORTHOGONAL' : 'POLYLINE',
        'elk.layered.spacing.nodeNodeBetweenLayers': layer,
        'elk.layered.spacing.edgeNodeBetweenLayers': String(NODE_GAP * o.spacing * 0.4),
        'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
        'elk.spacing.edgeNode': String(NODE_GAP * o.spacing * 0.4),
        'elk.spacing.edgeEdge': '20',
        'elk.layered.cycleBreaking.strategy': 'GREEDY',
        'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
        'elk.layered.thoroughness': '30',
      };
    case 'tree':
      return {
        ...common,
        'elk.direction': o.direction,
        'elk.mrtree.weighting': 'CONSTRAINT',
      };
    case 'radial':
      return common;
    case 'stress':
      return {
        ...common,
        'elk.stress.desiredEdgeLength': layer,
        'elk.stress.iterationLimit': '1000',
      };
    case 'force':
      return {
        ...common,
        'elk.force.model': 'EADES',
        'elk.force.iterations': '600',
        'elk.force.repulsion': String(Math.max(5, 5 * o.spacing)),
        'elk.force.temperature': '0.001',
      };
    case 'box':
      return {
        ...common,
        'elk.rectpacking.packing.compaction.iterativeCompaction': 'true',
        'elk.aspectRatio': '1.6',
      };
  }
}

const sizeOf = (n: DiagramNode) => ({
  width: n.visual?.size?.width ?? 100,
  height: n.visual?.size?.height ?? 60,
});

/**
 * Removes the redundant points ELK leaves on straight runs, and drops
 * consecutive duplicates.
 */
function simplify(points: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const collinearH = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01;
    const collinearV = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01;
    if (collinearH || collinearV) out.splice(i, 1);
  }
  return out;
}

/**
 * ELK attaches orthogonal edges to the node border, but the renderer draws
 * edges from the node centre and clips them to the shape itself. Re-anchor the
 * route at both centres, sliding the adjacent bend along its axis so every
 * segment stays axis-aligned.
 */
function anchorOrthogonalRoute(route: Point2D[], from: Point2D, to: Point2D): Point2D[] {
  if (route.length < 3) return [];
  const pts = route.map(p => ({ ...p }));
  const last = pts.length - 1;
  const startHorizontal = Math.abs(pts[0].y - pts[1].y) < 0.01;
  const endHorizontal = Math.abs(pts[last].y - pts[last - 1].y) < 0.01;

  if (startHorizontal) pts[1].y = from.y; else pts[1].x = from.x;
  if (endHorizontal) pts[last - 1].y = to.y; else pts[last - 1].x = to.x;

  pts[0] = { ...from };
  pts[last] = { ...to };
  return simplify(pts).slice(1, -1);
}

interface Size { width: number; height: number }

/**
 * ELK's radial algorithm assumes a tree and collapses general graphs, so this
 * lays out each connected component as concentric BFS rings instead. Subtrees
 * get angular wedges proportional to their leaf count, and each ring's radius
 * grows until neighbouring nodes fit.
 */
function layoutRadial(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  spacing: number,
  gap: number,
): Map<string, Point2D> {
  const size = new Map(nodes.map(n => [n.id, sizeOf(n)]));
  const radiusOf = (id: string) => Math.max(size.get(id)!.width, size.get(id)!.height) / 2;
  const ringGap = LAYER_GAP * spacing;

  const adjacency = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    adjacency.get(e.sourceNodeId)?.push(e.targetNodeId);
    adjacency.get(e.targetNodeId)?.push(e.sourceNodeId);
  }

  const visited = new Set<string>();
  const components: { positions: Map<string, Point2D>; width: number; height: number }[] = [];
  const byDegree = [...nodes].sort((a, b) => adjacency.get(b.id)!.length - adjacency.get(a.id)!.length);

  for (const start of byDegree) {
    if (visited.has(start.id)) continue;

    // BFS spanning tree rooted at the best-connected unvisited node.
    const depth = new Map<string, number>([[start.id, 0]]);
    const children = new Map<string, string[]>();
    const queue = [start.id];
    visited.add(start.id);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      children.set(id, []);
      for (const next of adjacency.get(id)!) {
        if (visited.has(next)) continue;
        visited.add(next);
        depth.set(next, depth.get(id)! + 1);
        children.get(id)!.push(next);
        queue.push(next);
      }
    }

    const leaves = new Map<string, number>();
    for (let i = queue.length - 1; i >= 0; i--) {
      const id = queue[i];
      const kids = children.get(id)!;
      leaves.set(id, kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + leaves.get(k)!, 0));
    }

    // Assign each node the middle of its wedge. BFS order keeps rings sorted by angle.
    const angle = new Map<string, number>([[start.id, 0]]);
    const wedge = new Map<string, [number, number]>([[start.id, [0, Math.PI * 2]]]);
    const rings: string[][] = [];
    for (const id of queue) {
      const d = depth.get(id)!;
      (rings[d] ??= []).push(id);
      const [from, to] = wedge.get(id)!;
      if (d > 0) angle.set(id, (from + to) / 2);
      let cursor = from;
      for (const k of children.get(id)!) {
        const span = ((to - from) * leaves.get(k)!) / leaves.get(id)!;
        wedge.set(k, [cursor, cursor + span]);
        cursor += span;
      }
    }

    const ringRadius: number[] = [0];
    for (let d = 1; d < rings.length; d++) {
      let r = ringRadius[d - 1] + ringGap;
      const ids = rings[d];
      for (let i = 0; i < ids.length; i++) {
        const j = (i + 1) % ids.length;
        if (ids.length < 2) break;
        let dTheta = angle.get(ids[j])! - angle.get(ids[i])!;
        if (dTheta <= 0) dTheta += Math.PI * 2;
        r = Math.max(r, (radiusOf(ids[i]) + radiusOf(ids[j]) + gap) / Math.min(dTheta, Math.PI));
      }
      ringRadius.push(r);
    }

    const local = new Map<string, Point2D>();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of queue) {
      const r = ringRadius[depth.get(id)!];
      const a = angle.get(id)!;
      const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      local.set(id, p);
      const { width, height } = size.get(id)!;
      minX = Math.min(minX, p.x - width / 2); maxX = Math.max(maxX, p.x + width / 2);
      minY = Math.min(minY, p.y - height / 2); maxY = Math.max(maxY, p.y + height / 2);
    }
    for (const p of local.values()) { p.x -= minX; p.y -= minY; }
    components.push({ positions: local, width: maxX - minX, height: maxY - minY });
  }

  // Shelf-pack the components, tallest first, into a roughly 3:2 sheet.
  components.sort((a, b) => b.height - a.height);
  const totalArea = components.reduce((sum, c) => sum + (c.width + gap) * (c.height + gap), 0);
  const sheetWidth = Math.max(components[0].width, Math.sqrt(totalArea * 1.5));
  const result = new Map<string, Point2D>();
  let x = 0, y = 0, rowHeight = 0;
  for (const c of components) {
    if (x > 0 && x + c.width > sheetWidth) { x = 0; y += rowHeight + COMPONENT_GAP * spacing; rowHeight = 0; }
    for (const [id, p] of c.positions) result.set(id, { x: p.x + x, y: p.y + y });
    x += c.width + COMPONENT_GAP * spacing;
    rowHeight = Math.max(rowHeight, c.height);
  }
  return result;
}

/**
 * Pushes overlapping nodes apart along the axis of least penetration. ELK's
 * stress and force layouts ignore node sizes. Skipped for very large graphs,
 * where the O(n^2) pass would stall the UI.
 */
function removeOverlaps(positions: Map<string, Point2D>, sizes: Map<string, Size>, pad: number) {
  const ids = [...positions.keys()];
  if (ids.length > 1500) return;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions.get(ids[i])!, b = positions.get(ids[j])!;
        const sa = sizes.get(ids[i])!, sb = sizes.get(ids[j])!;
        const overlapX = (sa.width + sb.width) / 2 + pad - Math.abs(a.x - b.x);
        const overlapY = (sa.height + sb.height) / 2 + pad - Math.abs(a.y - b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        // Coincident nodes get a deterministic nudge so they can separate.
        const dx = a.x === b.x ? (i % 2 ? 1 : -1) : Math.sign(b.x - a.x);
        const dy = a.y === b.y ? (j % 2 ? 1 : -1) : Math.sign(b.y - a.y);
        if (overlapX < overlapY) { a.x -= (dx * overlapX) / 2; b.x += (dx * overlapX) / 2; }
        else { a.y -= (dy * overlapY) / 2; b.y += (dy * overlapY) / 2; }
      }
    }
    if (!moved) return;
  }
}

/**
 * Lays out the top-level nodes; a container's nodes keep their places in it
 * and move with it (see utils/Nesting). Edges into containers count as edges
 * of the top-level nodes holding their ends, and lose their bend points.
 */
export async function computeLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<LayoutResult> {
  const nesting = nestingOf(nodes);
  if (!nodes.some(n => nesting.depth(n.id) > 0)) return computeFlatLayout(nodes, edges, options);

  const byId = new Map(nodes.map(n => [n.id, n]));
  const root = (id: string): string => {
    let node = byId.get(id);
    for (let p = node && nesting.parent(node.id); p; p = nesting.parent(p.id)) node = p;
    return node?.id ?? id;
  };
  const topLevel = nodes.filter(n => nesting.depth(n.id) === 0);
  const direct = edges.filter(e => root(e.sourceNodeId) === e.sourceNodeId && root(e.targetNodeId) === e.targetNodeId);
  const lifted = edges.filter(e => !direct.includes(e))
    .map(e => ({ ...e, id: `${e.id} (lifted)`, sourceNodeId: root(e.sourceNodeId), targetNodeId: root(e.targetNodeId), userVertices: [] }))
    .filter(e => e.sourceNodeId !== e.targetNodeId);
  const flat = await computeFlatLayout(topLevel, [...direct, ...lifted], options);

  const positions = new Map(flat.positions);
  for (const n of nodes) {
    if (positions.has(n.id)) continue;
    const r = byId.get(root(n.id))!, to = flat.positions.get(r.id);
    if (to) positions.set(n.id, { x: n.data.position.x + to.x - r.data.position.x, y: n.data.position.y + to.y - r.data.position.y });
  }
  const edgeVertices = new Map<string, Point2D[]>(edges.map(e => [e.id, direct.includes(e) ? flat.edgeVertices.get(e.id) ?? [] : []]));
  // Edges into containers: route them now that what's inside is in place too.
  if (options.edgeRouting !== 'STRAIGHT') {
    const placed = routeNodes(nodes, positions);
    const nested = edges.filter(e => !direct.includes(e) && e.sourceNodeId !== e.targetNodeId);
    for (const [id, vertices] of routeEdges(placed, nested.map(e => ({ id: e.id, source: e.sourceNodeId, target: e.targetNodeId })))) {
      edgeVertices.set(id, vertices);
    }
  }
  return { positions, edgeVertices };
}

/** Nodes as the edge router sees them: their boxes where the layout put them. */
function routeNodes(nodes: DiagramNode[], positions: Map<string, Point2D>): RouteNode[] {
  return nodes.flatMap(n => {
    const p = positions.get(n.id);
    return p ? [{ id: n.id, ...p, ...sizeOf(n), parentId: n.parentId, row: n.visual?.presentation === 'row' }] : [];
  });
}

async function computeFlatLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  options: LayoutOptions,
): Promise<LayoutResult> {
  const edgeVertices = new Map<string, Point2D[]>(edges.map(e => [e.id, []]));
  if (nodes.length === 0) return { positions: new Map(), edgeVertices };

  const sizes = new Map(nodes.map(n => [n.id, sizeOf(n)]));
  const nodeIds = new Set(nodes.map(n => n.id));
  // Self-loops and dangling edges carry no layout information.
  const usableEdges = edges.filter(
    e => e.sourceNodeId !== e.targetNodeId && nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId),
  );

  // Centres and raw edge routes in the layout's own coordinate space.
  let positions: Map<string, Point2D>;
  const routes = new Map<string, Point2D[]>();

  if (options.algorithm === 'radial') {
    positions = layoutRadial(nodes, usableEdges, options.spacing, nodeGap(options));
  } else {
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: buildElkOptions(options),
      children: nodes.map(n => ({ id: n.id, ...sizes.get(n.id)! })),
      edges: usableEdges.map<ElkExtendedEdge>(e => ({
        id: e.id,
        sources: [e.sourceNodeId],
        targets: [e.targetNodeId],
      })),
    };
    const result = await getElk().layout(graph);

    // ELK returns top-left corners; the renderer expects centres.
    positions = new Map(
      (result.children ?? []).map(c => [
        c.id,
        { x: (c.x ?? 0) + (c.width ?? 0) / 2, y: (c.y ?? 0) + (c.height ?? 0) / 2 },
      ]),
    );

    if (options.algorithm === 'stress' || options.algorithm === 'force') {
      removeOverlaps(positions, sizes, Math.max(NODE_GAP * options.spacing * 0.5, options.grid ?? 0));
    } else if (options.algorithm === 'layered' && options.edgeRouting !== 'STRAIGHT') {
      for (const elkEdge of (result.edges ?? []) as ElkExtendedEdge[]) {
        const section = elkEdge.sections?.[0];
        if (section) routes.set(elkEdge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
      }
    }
  }

  // Re-centre the whole drawing on the origin so repeated layouts don't drift.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, p] of positions) {
    const { width, height } = sizes.get(id)!;
    minX = Math.min(minX, p.x - width / 2); maxX = Math.max(maxX, p.x + width / 2);
    minY = Math.min(minY, p.y - height / 2); maxY = Math.max(maxY, p.y + height / 2);
  }
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  const toWorld = (p: Point2D): Point2D => ({ x: p.x - ox, y: p.y - oy });
  positions = new Map([...positions].map(([id, p]) => [id, toWorld(p)]));
  // On the grid before any routing, so edges are routed (or anchored) to where the nodes end up.
  if (options.grid) positions = snapToGrid(positions, sizes, options.grid);

  // Only layered routes its edges; route the others' around the nodes.
  if (options.algorithm !== 'layered' && options.edgeRouting !== 'STRAIGHT') {
    const placed = routeNodes(nodes, positions);
    const edgeRoutes = routeEdges(placed, usableEdges.map(e => ({ id: e.id, source: e.sourceNodeId, target: e.targetNodeId })));
    for (const [id, vertices] of edgeRoutes) edgeVertices.set(id, vertices);
  }

  const edgesById = new Map(usableEdges.map(e => [e.id, e]));
  for (const [id, route] of routes) {
    const edge = edgesById.get(id)!;
    const from = positions.get(edge.sourceNodeId)!;
    const to = positions.get(edge.targetNodeId)!;
    const world = route.map(toWorld);
    edgeVertices.set(
      id,
      options.edgeRouting === 'ORTHOGONAL' ? anchorOrthogonalRoute(world, from, to) : simplify(world).slice(1, -1),
    );
  }

  return { positions, edgeVertices };
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function nodeBounds(nodes: DiagramNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const n of nodes) {
    const { width, height } = sizeOf(n);
    const { x, y } = n.data.position;
    b.minX = Math.min(b.minX, x - width / 2); b.maxX = Math.max(b.maxX, x + width / 2);
    b.minY = Math.min(b.minY, y - height / 2); b.maxY = Math.max(b.maxY, y + height / 2);
  }
  return b;
}
