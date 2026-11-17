import type { DiagramEdge, DiagramNode } from '../types';
import type { DiagramFont } from './FontLoadUtils';
import type { NodeTemplate } from './NodeTemplates';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Node properties a user can edit in the properties panel. */
export interface NodeChanges {
  label?: string;
  color?: string;
  labelColor?: string;
  iconColor?: string;
  labelFont?: DiagramFont;
}

/**
 * A change the user made in the editor, reported through `DiagramProvider`'s
 * `onEdit`. Loading a file, auto-layout and programmatic `addNode`/`updateNode`
 * calls are not edits, so a host that applies changes itself never sees them
 * echoed back.
 *
 * Moves, resizes and bend-point drags are reported once, when the drag ends.
 * Property changes are reported as they happen (per keystroke or colour pick);
 * debounce in the host if applying them is costly.
 */
export type DiagramEdit =
  | { kind: 'node-added'; node: DiagramNode; template: NodeTemplate }
  | { kind: 'node-removed'; node: DiagramNode; edges: DiagramEdge[] }
  | { kind: 'node-moved'; nodeId: string; from: Point; to: Point }
  | { kind: 'node-resized'; nodeId: string; from: { position: Point; size: Size }; to: { position: Point; size: Size } }
  | { kind: 'node-changed'; nodeId: string; changes: NodeChanges }
  | { kind: 'edge-added'; edge: DiagramEdge }
  | { kind: 'edge-removed'; edge: DiagramEdge }
  | { kind: 'edge-reshaped'; edgeId: string; from: Point[]; to: Point[] };
