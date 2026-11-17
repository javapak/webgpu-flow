import type { DiagramEdge, DiagramNode } from '../types';
import type { MarkerType } from '../renderers/FloatingEdgeRenderer';

/**
 * The diagram file format: what `parseDiagram` loads and `serializeDiagram` saves.
 *
 * It is plain JSON of the renderer's own `DiagramNode` / `DiagramEdge`, plus a
 * header. Producers outside this repo (hand-written files, generators such as
 * arbor) target this format; they never import the editor.
 */
export const DIAGRAM_FORMAT = 'webgpu-flow/diagram';
export const DIAGRAM_FORMAT_VERSION = 1;

export interface DiagramDocument {
  format: typeof DIAGRAM_FORMAT;
  version: typeof DIAGRAM_FORMAT_VERSION;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface ParseResult {
  /** Always usable: invalid nodes and edges are dropped, missing fields get defaults. */
  document: DiagramDocument;
  /** One line per dropped item or repaired field, for showing to whoever produced the file. */
  problems: string[];
}

const DEFAULT_SIZE = { width: 100, height: 60 };
const DEFAULT_EDGE_STYLE: DiagramEdge['style'] = { color: [0, 0, 0, 1], thickness: 2 };

const MARKERS: ReadonlySet<string> = new Set<MarkerType>([
  'none', 'arrow', 'open-arrow', 'filled-arrow', 'diamond', 'filled-diamond', 'circle', 'cross',
  'crow-foot', 'crow-foot-optional', 'crow-foot-mandatory', 'one', 'one-optional', 'many-optional',
  'constraint', 'inheritance', 'realization', 'double-arrow', 'bar', 'dot', 'square',
]);

/**
 * Reads a diagram from parsed JSON. Accepts the versioned format and, for
 * existing files, a bare `{ nodes, edges }` without a header.
 */
export function parseDiagram(json: unknown): ParseResult {
  const problems: string[] = [];
  const doc: DiagramDocument = { format: DIAGRAM_FORMAT, version: DIAGRAM_FORMAT_VERSION, nodes: [], edges: [] };

  if (!isObject(json)) {
    problems.push('expected a JSON object with "nodes" and "edges"');
    return { document: doc, problems };
  }
  if (json.format !== undefined && json.format !== DIAGRAM_FORMAT) {
    problems.push(`unknown format "${String(json.format)}", reading it as ${DIAGRAM_FORMAT}`);
  }
  if (typeof json.version === 'number' && json.version > DIAGRAM_FORMAT_VERSION) {
    problems.push(`file is format version ${json.version}, this editor reads version ${DIAGRAM_FORMAT_VERSION}`);
  }

  const ids = new Set<string>();
  for (const [i, raw] of arrayOf(json.nodes, 'nodes', problems).entries()) {
    const node = parseNode(raw, `nodes[${i}]`, problems);
    if (!node) continue;
    if (ids.has(node.id)) { problems.push(`nodes[${i}]: duplicate id "${node.id}", dropped`); continue; }
    ids.add(node.id);
    doc.nodes.push(node);
  }

  const edgeIds = new Set<string>();
  for (const [i, raw] of arrayOf(json.edges, 'edges', problems).entries()) {
    const edge = parseEdge(raw, `edges[${i}]`, problems);
    if (!edge) continue;
    const missing = [edge.sourceNodeId, edge.targetNodeId].filter(id => !ids.has(id));
    if (missing.length) { problems.push(`edges[${i}]: unknown node "${missing[0]}", dropped`); continue; }
    if (edgeIds.has(edge.id)) { problems.push(`edges[${i}]: duplicate id "${edge.id}", dropped`); continue; }
    edgeIds.add(edge.id);
    doc.edges.push(edge);
  }

  return { document: doc, problems };
}

/** Writes the current diagram in the file format, without editor-only state such as selection. */
export function serializeDiagram(diagram: { nodes: DiagramNode[]; edges: DiagramEdge[] }): DiagramDocument {
  return {
    format: DIAGRAM_FORMAT,
    version: DIAGRAM_FORMAT_VERSION,
    nodes: diagram.nodes.map(node => {
      // `velocity` is scratch state of the force layout, the rest is per-session render state.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { velocity, ...data } = node.data;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { selected, cacheKey, ...visual } = node.visual ?? {};
      return structuredClone({ id: node.id, type: node.type, data, visual });
    }),
    edges: diagram.edges.map(edge => structuredClone({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      userVertices: edge.userVertices,
      style: edge.style,
      ...(edge.data ? { data: edge.data } : {}),
    })),
  };
}

function parseNode(raw: unknown, at: string, problems: string[]): DiagramNode | undefined {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) {
    problems.push(`${at}: needs a string "id", dropped`);
    return undefined;
  }
  const data = isObject(raw.data) ? { ...raw.data } : {};
  const visual = isObject(raw.visual) ? { ...raw.visual } : {};

  // Older files keep the position at the top level.
  const position = point(data.position) ?? point(raw.position);
  if (!position) problems.push(`${at} ("${raw.id}"): no position, placed at 0,0`);
  data.position = position ?? { x: 0, y: 0 };

  // The renderer and hit-testing read visual.size; resizing also keeps data.size in step.
  const size = dimensions(visual.size) ?? dimensions(data.size) ?? DEFAULT_SIZE;
  visual.size = { ...size };
  if (data.size !== undefined) data.size = { ...size };

  delete visual.selected;
  return {
    id: raw.id,
    type: typeof raw.type === 'string' ? raw.type : 'default',
    data: data as DiagramNode['data'],
    visual,
  };
}

function parseEdge(raw: unknown, at: string, problems: string[]): DiagramEdge | undefined {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.sourceNodeId !== 'string' || typeof raw.targetNodeId !== 'string') {
    problems.push(`${at}: needs string "id", "sourceNodeId" and "targetNodeId", dropped`);
    return undefined;
  }
  const style = isObject(raw.style) ? raw.style : {};
  const color = Array.isArray(style.color) && style.color.length === 4 && style.color.every(c => typeof c === 'number')
    ? style.color as [number, number, number, number]
    : DEFAULT_EDGE_STYLE.color;
  return {
    id: raw.id,
    sourceNodeId: raw.sourceNodeId,
    targetNodeId: raw.targetNodeId,
    userVertices: Array.isArray(raw.userVertices) ? raw.userVertices.flatMap(v => point(v) ?? []) : [],
    style: {
      ...style,
      color,
      thickness: typeof style.thickness === 'number' ? style.thickness : DEFAULT_EDGE_STYLE.thickness,
      sourceMarker: marker(style.sourceMarker, `${at}.style.sourceMarker`, problems),
      targetMarker: marker(style.targetMarker, `${at}.style.targetMarker`, problems),
    },
    ...(isObject(raw.data) ? { data: raw.data } : {}),
  };
}

/** Empty or missing markers mean none; unknown ones are reported and dropped. */
function marker(v: unknown, at: string, problems: string[]): MarkerType | undefined {
  if (v === undefined || v === '' || v === null) return undefined;
  if (typeof v === 'string' && MARKERS.has(v)) return v as MarkerType;
  problems.push(`${at}: unknown marker "${String(v)}", dropped`);
  return undefined;
}

function arrayOf(v: unknown, name: string, problems: string[]): unknown[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v;
  problems.push(`"${name}" must be an array`);
  return [];
}

function point(v: unknown): { x: number; y: number } | undefined {
  return isObject(v) && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x as number, y: v.y as number } : undefined;
}

function dimensions(v: unknown): { width: number; height: number } | undefined {
  return isObject(v) && Number.isFinite(v.width) && Number.isFinite(v.height)
    ? { width: v.width as number, height: v.height as number }
    : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
