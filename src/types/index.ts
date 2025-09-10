// Core types for the diagram system
// Add these types to your types/index.ts
export interface InteractionState {
  mode: 'idle' | 'dragging' | 'panning';
  dragTarget: string | null; // node ID being dragged
  lastMousePos: { x: number; y: number };
  selectedNodes: NodeSchema[];
}

export interface NodeSchema {
  id: string;
  type: string;
  visual: {
    width?: number;
    selected?: boolean,
    height?: number;
    color?: string;
    shape?: 'rectangle' | 'circle' | 'diamond' | 'package' | 'roundedRectangle' | 'hexagon' | 'initialNode' | 'finalNode' | 'oval' | 'actor';
    ports?: Array<{
      id: string;
      position: 'top' | 'bottom' | 'left' | 'right';
      offset?: number;
    }>;
  };
  data: {
    [key: string]: any;
  };
}

export interface EdgeSchema {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  visual: {
    color?: string;
    width?: number;
    style?: 'solid' | 'dashed' | 'dotted';
  };
}

export interface DiagramState {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface WebGPURenderer {
  canvas: HTMLCanvasElement | null;
  root: any | null; // TypeGPU root instance
  initialized: boolean;
  render: (state: DiagramState) => Promise<void>;
  cleanup: () => void;
}

export interface DiagramContextType {
  state: DiagramState;
  renderer: WebGPURenderer | null;
  interactionState: InteractionState;
  setInteractionState: (interactionState: InteractionState | any) => void;
  setSelectedNodes: (nodeIds: NodeSchema[]) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  updateNodes: (nodes: NodeSchema[]) => void;
  updateEdges: (edges: EdgeSchema[]) => void;
  setViewport: (viewport: Partial<DiagramState['viewport']>) => void;
  addNode: (node: NodeSchema) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: EdgeSchema) => void;
  removeEdge: (edgeId: string) => void;
}