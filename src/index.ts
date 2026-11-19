// Library entry: what a host app needs to embed the editor. The demo app
// (main.tsx, App.tsx) is built from these same pieces.

// Types
export type { DiagramNode, DiagramEdge, DiagramState, Viewport, NodeSchema } from './types';
export type { DiagramEdit, NodeChanges } from './utils/DiagramEdits';
export type { MarkerType } from './renderers/FloatingEdgeRenderer';

// Startup: call startRenderer() once before mounting DiagramProvider.
export { startRenderer } from './renderers/startRenderer';
export { default as WebGPUUnsupported, type WebGPUFailure } from './components/WebGPUUnsupported';

// State and canvas
export { DiagramProvider, useDiagram, InteractionMode, type DiagramContextValue } from './components/DiagramProvider';
export { DiagramCanvas } from './components/DiagramCanvas';
export { useRenderSettings, type Resolution } from './state/renderSettings';
export { default as RenderSettingsModal, type RenderSettingsModalProps } from './components/RenderSettingsModal';

// Automatic layout (DiagramProvider's applyLayout)
export { setLayoutWorker, DEFAULT_LAYOUT_OPTIONS, type LayoutOptions, type LayoutAlgorithm, type LayoutDirection, type EdgeRouting } from './layout/graphLayout';

// Palette
export { default as NodePalette } from './components/NodePalette';
export { DEFAULT_PALETTE, createNodeFromTemplate, type NodeTemplate } from './utils/NodeTemplates';

// Diagram files
export { parseDiagram, serializeDiagram, DIAGRAM_FORMAT, DIAGRAM_FORMAT_VERSION, type DiagramDocument, type ParseResult } from './utils/DiagramIO';

// Declarative building blocks and the renderer itself
export { Node } from './components/Node';
export { Edge } from './components/Edge';
export { WebGPURenderer } from './renderers/WebGPURenderer';
