import type { DiagramNode } from '../types';

/**
 * A node type offered in the palette: a node minus its id and position.
 *
 * Diagram files may carry their own palette (see DiagramIO), so a generator
 * can offer exactly the node types its notation has; files without one get
 * DEFAULT_PALETTE.
 */
export interface NodeTemplate {
  /** Unique within the palette. */
  id: string;
  /** Shown in the palette and used as the new node's label. */
  label: string;
  /** Palette section heading. */
  group?: string;
  /** Becomes the node's `type`. */
  type: string;
  /** Becomes the node's `visual`; `visual.size` is its initial size. */
  visual: NonNullable<DiagramNode['visual']> & { size: { width: number; height: number } };
  /** Copied into the node's `data`, e.g. to tag what the node stands for. */
  data?: Record<string, unknown>;
}

export const DEFAULT_PALETTE: NodeTemplate[] = [
  { id: 'process', label: 'Process', type: 'process', visual: { shape: 'rectangle', color: '#3b82f6', size: { width: 120, height: 60 } } },
  { id: 'decision', label: 'Decision', type: 'decision', visual: { shape: 'diamond', color: '#f59e0b', size: { width: 100, height: 80 } } },
  { id: 'database', label: 'Database', type: 'database', visual: { shape: 'circle', color: '#10b981', size: { width: 100, height: 100 } } },
  { id: 'start', label: 'Start', type: 'start', visual: { shape: 'initialNode', color: '#22c55e', size: { width: 60, height: 60 } } },
  { id: 'end', label: 'End', type: 'end', visual: { shape: 'finalNode', color: '#ef4444', size: { width: 60, height: 60 } } },
  { id: 'actor', label: 'Actor', type: 'actor', visual: { shape: 'actor', color: '#8b5cf6', size: { width: 80, height: 100 } } },
  { id: 'package', label: 'Package', type: 'package', visual: { shape: 'package', color: '#06b6d4', size: { width: 120, height: 80 } } },
];

/** Drag-and-drop payload type for a template dragged from the palette. */
export const TEMPLATE_MIME = 'application/x-webgpu-flow-template';

/**
 * A new node from a template. The id is `<template id>-<n>` and the label
 * `<label> <n>`, with n the first number not already used by `existingIds`.
 */
export function createNodeFromTemplate(
  template: NodeTemplate,
  position: { x: number; y: number },
  existingIds: ReadonlySet<string>,
): DiagramNode {
  const base = template.id.replace(/[^\w-]+/g, '-');
  let n = 1;
  while (existingIds.has(`${base}-${n}`)) n++;
  const { size, ...visual } = structuredClone(template.visual);
  return {
    id: `${base}-${n}`,
    type: template.type,
    data: {
      ...structuredClone(template.data ?? {}),
      label: `${template.label} ${n}`,
      position: { ...position },
      size: { ...size },
    },
    visual: { labelFont: 'Arial', ...visual, size: { ...size } },
  };
}
