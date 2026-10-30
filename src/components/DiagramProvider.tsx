// TODO: viewport culling is disabled. Culling an off-screen node also dropped every
// edge attached to it, even edges whose other end was on screen.

import { useReducer, useEffect, useCallback, useMemo, useContext, createContext, useRef, useState, useLayoutEffect } from "react";
import { useSpatialIndex } from "../hooks/useSpatialIndex";
import { WebGPURenderer } from "../renderers/WebGPURenderer";
import { MouseInteractions, type ResizeHandle } from "../utils/MouseInteractions";
import type { Viewport, DiagramState, DiagramNode, DiagramEdge, SpatialDiagramHook, InteractionState } from "../types";
import type { AABB, Point } from "../types/spatial-indexing/types";
import type { FloatingEdge } from "../renderers/FloatingEdgeRenderer";
import { GridSnapping } from '../utils/GridSnapping';
import globalRenderer from '../renderers/gpuInstance'
import { canvasToWorld, clampZoom, clientToCanvas as clientToCanvasPoint, zoomAbout, type View } from '../utils/CanvasCoords';
import { computeLayout, nodeBounds, DEFAULT_LAYOUT_OPTIONS, type LayoutOptions, type LayoutResult } from '../layout/graphLayout';

export const InteractionMode = {
  SELECT: 0,
  DRAW_EDGE: 1
} as const



export interface EdgeDrawingState {
  isDrawing: boolean;
  sourceNodeId: string | null;
  userVertices: Array<{x: number, y: number}>;
  style?: { color: [number, number, number, number]; thickness: number};
}


export interface DiagramContextValue extends DiagramState {
  addNode: (node: DiagramNode) => void;
  interactionRef: React.RefObject<InteractionState>
  viewportRef: React.RefObject<Viewport>
  addEdge: (edge: DiagramEdge) => void;
  removeNode: (nodeId: string) => void;
  supportedSupersamplingFactors:number[];
  supersamplingWarnings: string[];
  updateNode: (node: DiagramNode) => void;
  clearVertexSelection: () => void;
  updateEdge: (edge: DiagramEdge) => void;
  /** Computes a layout for the current graph, applies it and frames the result. */
  applyLayout: (options?: Partial<LayoutOptions>) => Promise<void>;
  /** Pans/zooms the viewport (animated by default) so the whole graph is visible. */
  fitToContent: (options?: { padding?: number; animate?: boolean }) => void;
  /** Zooms about the centre of the view by a factor, animated. */
  zoomBy: (factor: number) => void;
  /** Zooms about the centre of the view to an absolute level, animated. */
  setZoom: (zoom: number) => void;
  /** Stops an in-flight fit/zoom animation; call when the user takes over the viewport. */
  cancelViewportAnimation: () => void;
  setGridSnapping: (enabled: boolean) => void;
  removeEdge: (edgeId: string) => void;
  selectEdge: (edge: DiagramEdge | null) => void;
  clearEdgeSelection: () => void;
  selectEdgeVertex: (edgeID: string, vertexIndex: number | null) => void;
  supersamplingOptions: string[];
  getVisibleNodes: () => DiagramNode[];
  hitTestPoint: (screenPoint: Point) => DiagramNode[];
  hitTestWithHandles: (screenPoint: Point) => { nodes: DiagramNode[]; resizeHandle: ResizeHandle };
  mode: number;
  drawingState: EdgeDrawingState;
  focusedOnInput: boolean;
  setFocusedOnInput: (val: boolean) => void;
  toggleMode: () => void;
  exitDrawMode: () => void;
  startDrawing: (nodeId: string) => void;
  addControlPoint: (point: {x: number, y: number}, replaceLast?: boolean) => void;
  completeEdge: (targetNodeId: string) => FloatingEdge | null;
  cancelDrawing: () => void;
  fxaaEnabled: boolean;
  setFXAAEnabled: (enabled: boolean) => void;
  smaaEnabled: boolean;
  setSMAAEnabled: (enabled: boolean) => void;

  // Edge vertex manipulation
  updateEdgeVertex: (edgeId: string, vertexIndex: number, newPosition: {x: number, y: number}) => void;
  addEdgeVertex: (edgeId: string, position: {x: number, y: number}, insertAtIndex?: number) => void;
  removeEdgeVertex: (edgeId: string, vertexIndex: number) => void;
  
  // Hit testing for edges
  hitTestEdge: (screenPoint: Point) => {edge: DiagramEdge | null, vertexIndex: number, isVertex: boolean};
  /** Index of the vertex under the point, or -1. */
  hitTestEdgeVertex: (screenPoint: Point, edge: DiagramEdge) => number;
  
  // Viewport methods
  setViewport: (viewport: Partial<DiagramState['viewport']>) => void;
  /** Takes canvas-backing-store pixels (see CanvasCoords.ts), not CSS pixels. */
  screenToWorld: (screenPoint: Point) => Point;
  /** Converts page (client) coordinates to canvas-backing-store pixels. */
  clientToCanvas: (clientX: number, clientY: number) => Point;
  worldToScreen: (worldPoint: Point) => Point;
  setAltKey: (pressed: boolean) => void;

  // Selection methods
  selectNode: (node: DiagramNode | null) => void;
  clearSelection: () => void;
  
  // Interaction methods
  startDrag: (type: 'node' | 'viewport' | 'resize' | 'edge-vertex', screenPoint: Point, resizeHandle?: ResizeHandle, edgeID?: string, edgeVertexIndex?: number) => void;
  updateDrag: (screenPoint: Point, isSnapped?: boolean) => void;
  endDrag: () => void;
  
  // Renderer methods
  getRenderer: () => WebGPURenderer | null;
  isRendererInitialized: () => boolean;
  initializeRenderer: (canvas: HTMLCanvasElement) => Promise<boolean>;
  renderFrame: () => void;
  
  // Debug
  getSpatialDebugInfo: () => any;
  handleSampleCountChange: (value: string) => Promise<void>;
  handleSupersamplingChange: (value: string) => Promise<void>;
  sampleCount: string;
  supersamplingValue: string
}

const DiagramContext = createContext<DiagramContextValue | null>(null);

type DiagramAction =
  | { type: 'ADD_NODE'; node: DiagramNode }
  | { type: 'REMOVE_NODE'; nodeId: string }
  | { type: 'UPDATE_NODE'; node: DiagramNode }
  | { type: 'ADD_EDGE'; edge: DiagramEdge }
  | { type: 'REMOVE_EDGE'; edgeId: string }
  | { type: 'UPDATE_EDGE'; edge: DiagramEdge }
  | { type: 'APPLY_LAYOUT'; layout: LayoutResult }
  | { type: 'SET_GRID_SNAPPING'; enabled: boolean }
  | { type: 'SET_VIEWPORT'; viewport: Partial<Viewport> }
  | { type: 'SELECT_NODE'; node: DiagramNode | null }
  | { type: 'SELECT_EDGE'; edge: DiagramEdge | null }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_ALT_KEY'; pressed: boolean }
  | { type: 'CLEAR_EDGE_SELECTION' }
  | { type: 'START_DRAG'; dragType: 'node' | 'viewport' | 'resize' | 'edge-vertex'; startPos: Point; resizeHandle?: ResizeHandle; edgeId?: string; vertexIndex?: number }  | { type: 'UPDATE_DRAG'; currentPos: Point, isSnapped?: boolean }
  | { type: 'END_DRAG' }
  | { type: 'SELECT_EDGE_VERTEX'; edgeID: string; vertexIndex: number | null }
  | { type: 'CLEAR_VERTEX_SELECTION' };






export const diagramReducer = (state: DiagramState, action: DiagramAction): DiagramState => {
  
  switch (action.type) {

  case 'SET_ALT_KEY':
  return {
    ...state,
    interaction: {
      ...state.interaction,
      altKeyPressed: action.pressed
      
    },
  };
    case 'ADD_NODE':
      return {
        ...state,
        nodes: [...state.nodes, action.node],
      };

    case 'REMOVE_NODE':
      return {
        ...state,
        nodes: state.nodes.filter(node => node.id !== action.nodeId),
        interaction: {
          ...state.interaction,
          selectedNodes: state.interaction.selectedNodes.filter(
            node => node.id !== action.nodeId
          ),
        },
      };

    case 'UPDATE_NODE':
      return {
        ...state,
        nodes: state.nodes.map(node =>
          node.id === action.node.id ? action.node : node
        ),
        interaction: {
          ...state.interaction,
          selectedNodes: state.interaction.selectedNodes.map(node =>
            node.id === action.node.id ? action.node : node
          ),
        },
      };


    case 'SET_GRID_SNAPPING':
      return { ...state, gridSnapping: { ...state.gridSnapping, enabled: action.enabled } };

    case 'APPLY_LAYOUT': {
      const { positions, edgeVertices } = action.layout;
      const moved = state.nodes.map((node): DiagramNode => {
        const position = positions.get(node.id);
        return position ? { ...node, data: { ...node.data, position } } : node;
      });
      // Drags mutate node.data in place, so the selection must share the
      // exact objects held in `nodes`, not separate copies.
      const movedById = new Map(moved.map(node => [node.id, node]));
      const moveNode = (node: DiagramNode) => movedById.get(node.id) ?? node;
      return {
        ...state,
        nodes: moved,
        edges: state.edges.map(edge => {
          const userVertices = edgeVertices.get(edge.id);
          return userVertices ? { ...edge, userVertices } : edge;
        }),
        interaction: {
          ...state.interaction,
          selectedNodes: state.interaction.selectedNodes.map(moveNode),
          selectedVertex: null,
        },
      };
    }

    case 'SELECT_EDGE_VERTEX':
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedVertex: {edgeId: action.edgeID, vertexIndex: action.vertexIndex as number}
        } 
      };

    case 'ADD_EDGE':
      return {
        ...state,
        edges: [...state.edges, action.edge],
      };

    case 'REMOVE_EDGE':
      return {
        ...state,
        edges: state.edges.filter(edge => edge.id !== action.edgeId),
      };

    case 'UPDATE_EDGE':
      return {
        ...state,
        edges: state.edges.map(edge =>
          edge.id === action.edge.id ? action.edge : edge
        ),
        interaction: {
          ...state.interaction,
          selectedEdges: state.interaction.selectedEdges.map(edge =>
            edge.id === action.edge.id ? action.edge : edge
          ),
        },
      };

    case 'SET_VIEWPORT':
      return {
        ...state,
        viewport: { ...state.viewport, ...action.viewport },
      };

    case 'SELECT_NODE':
      
      // Update the selected node to have visual.selected = true
      let updatedNodes = state.nodes;
      if (action.node) {
        updatedNodes = state.nodes.map(node => ({
          ...node,
          visual: {
            ...node.visual,
            selected: node.id === action.node!.id
          }
        }));
      } else {
        // Clear all selections
        updatedNodes = state.nodes.map(node => ({
          ...node,
          visual: {
            ...node.visual,
            selected: false
          }
        }));
      }
      
      return {
        ...state,
        nodes: updatedNodes,
        interaction: {
          ...state.interaction,
          selectedNodes: action.node ? [action.node] : [],
        },
        
      };

    case 'SELECT_EDGE':
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedEdges: action.edge ? [action.edge] : [],
        }
      }
    case 'CLEAR_SELECTION':
      
      // Clear all visual selection indicators
      const clearedNodes = state.nodes.map(node => ({
        ...node,
        visual: {
          ...node.visual,
          selected: false
        }
      }));
      
      return {
        ...state,
        nodes: clearedNodes,
        interaction: {
          ...state.interaction,
          selectedNodes: [],
        },
      };
    
    case 'CLEAR_EDGE_SELECTION':
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedEdges: [],
        },
      };

    case 'CLEAR_VERTEX_SELECTION':
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedVertex: null,
        },  
      };

    case 'START_DRAG':
      const selectedNode = state.interaction.selectedNodes[0];
      let originalSize, originalPosition, originalVertexPosition;

      if (action.dragType === 'edge-vertex' && action.edgeId && action.vertexIndex !== undefined) {
        const edge = state.edges.find(e => e.id === action.edgeId);
        if (edge && edge.userVertices[action.vertexIndex]) {
          originalVertexPosition = { ...edge.userVertices[action.vertexIndex] };
        }
      }

      if (action.dragType === 'resize' && selectedNode) {
        originalSize = selectedNode.data.size ? { ...selectedNode.data.size } : { width: 100, height: 60 };
        originalPosition = selectedNode.data.position ? { ...selectedNode.data.position } : { x: 0, y: 0 };

      }
      
      return {
        ...state,
        interaction: {
          ...state.interaction,
          dragState: {
            isDragging: true,
            dragType: action.dragType,
            startPos: action.startPos,
            lastPos: action.startPos,
            vertexIndex: action.vertexIndex,
            edgeId: action.edgeId,
            originalVertexPosition,
            resizeHandle: action.resizeHandle,
            originalSize,
            originalPosition,
          },
        },
      };
    
    case 'END_DRAG':
    return {
        ...state,
        interaction: {
            ...state.interaction,
            dragState: {
                isDragging: false,
                dragType: null,
                startPos: null,
                lastPos: null,
                resizeHandle: undefined,
                originalSize: undefined,
                originalPosition: undefined,
                edgeId: undefined,
                vertexIndex: undefined,
                originalVertexPosition: undefined,
            },
        },
    };
  
    return {
      ...state,
      interaction: {
        ...state.interaction,
        dragState: {
          isDragging: false,
          dragType: null,
          startPos: null,
          lastPos: null,
          resizeHandle: undefined,
          originalSize: undefined,
          originalPosition: undefined,
          edgeId: undefined,
          vertexIndex: undefined,
          originalVertexPosition: undefined,
        },
      },
    };

    default:
      return state;
  }
};

interface DiagramProviderProps {
  children: React.ReactNode;
  initialBounds?: AABB;
  initialViewport?: Partial<Viewport>;
}

export const DiagramProvider: React.FC<DiagramProviderProps> = ({
  children,
  initialBounds = { minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 },
  initialViewport = {},
}) => {
  const initialState: DiagramState = {
    nodes: [],
    edges: [],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
      width: 800,
      height: 600,
      ...initialViewport,
    },
    interaction: {
      selectedNodes: [],
      selectedEdges: [],
      selectedVertex: null,
      altKeyPressed: false,
      dragState: {
        isDragging: false,
        dragType: null,
        startPos: null,
        lastPos: null,
      },
      mode: 'select',
    },
    gridSnapping: {
      enabled: true,
      gridSize: GridSnapping.getDefaultGridSize(),
    }
  };

  // State and refs
  const [state, dispatch] = useReducer(diagramReducer, initialState);
  const spatial: SpatialDiagramHook = useSpatialIndex(initialBounds);
  const rendererRef = useRef<WebGPURenderer | null>(globalRenderer);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const [supersamplingValue, setSuperSamplingValue] = useState('Disabled');
  const [supportedSupersamplingFactors, setSupportedSupersamplingFactors] = useState<number[]>([]);
  const [supersamplingWarnings, setSupersamplingWarnings] = useState<string[]>([]);
  const [initComplete, setInitComplete] = useState<boolean>(false);
  const [fxaaEnabled, setFXAAEnabledState] = useState(false);
  const [smaaEnabled, setSMAAEnabledState] = useState(false);
  const [sampleCount, setSampleCount] = useState('1');
  const [mode, setMode] = useState<number>(InteractionMode.SELECT);
  const [focusedOnInput, setFocusedOnInput] = useState(false);
  const [drawingState, setDrawingState] = useState<EdgeDrawingState>({
    isDrawing: false,
    sourceNodeId: null,
    userVertices: []
  });

  const interactionRef = useRef<InteractionState>({altKeyPressed: false, selectedVertex: null, dragState: {isDragging: false, dragType: 'viewport', lastPos: null, startPos: null }, mode: 'select', selectedEdges: [], selectedNodes: []})


const viewportRef = useRef<Viewport>({
    x: 0, y: 0, zoom: 1,
    width: 800, height: 600,
});

const drawingStateRef = useRef<EdgeDrawingState>(drawingState);
// Frames read the ref (not state) so they never lag a render behind. A layout effect
// syncs it before the canvas schedules the next frame, keeping the edge preview current.
useLayoutEffect(() => {
  drawingStateRef.current = drawingState;
}, [drawingState]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);



const updateDrag = useCallback((screenPoint: Point) => {
    const drag = interactionRef.current;
    if (!drag.dragState.isDragging || !drag.dragState.lastPos) return;

    const deltaX = screenPoint.x - drag.dragState.lastPos.x;
    const deltaY = screenPoint.y - drag.dragState.lastPos.y;
    drag.dragState.lastPos = screenPoint; // mutate in place

    if (drag.dragState.dragType === 'viewport') {
        const zoom = viewportRef.current.zoom;
        viewportRef.current.x += -deltaX / zoom;
        viewportRef.current.y += -deltaY / zoom;
        scheduleRender();

    } else if (drag.dragState.dragType === 'node') {
        const selectedNode = stateRef.current.interaction.selectedNodes[0];
        if (!selectedNode) return;
        const zoom = viewportRef.current.zoom;
        selectedNode.data.position.x += deltaX / zoom;
        selectedNode.data.position.y += deltaY / zoom;
        scheduleRender();

    } else if (drag.dragState.dragType === 'resize') {
        const { originalSize, originalPosition, resizeHandle, startPos } = drag.dragState;
        const selected = stateRef.current.interaction.selectedNodes[0];
        if (!selected || !originalSize || !originalPosition || !resizeHandle || !startPos) return;

        // calculateResize works from the original geometry and the total delta.
        const zoom = viewportRef.current.zoom;
        const next = MouseInteractions.calculateResize(
            resizeHandle,
            (screenPoint.x - startPos.x) / zoom,
            (screenPoint.y - startPos.y) / zoom,
            originalSize.width, originalSize.height,
            originalPosition.x, originalPosition.y,
            12, 12,
            MouseInteractions.shouldLockAspectRatio(selected.visual?.shape),
        );

        // `visual` is copied per node on selection, so update both the stored node and the selected copy.
        const stored = stateRef.current.nodes.find(n => n.id === selected.id);
        for (const node of [stored, selected]) {
            if (!node) continue;
            node.visual = { ...node.visual, size: { width: next.width, height: next.height } };
            node.data.position = { x: next.x, y: next.y };
            if (node.data.size) node.data.size = { width: next.width, height: next.height };
        }
        scheduleRender();

    } else if (drag.dragState.dragType === 'edge-vertex') {
        const { edgeId, vertexIndex, originalVertexPosition, startPos } = drag.dragState;
        if (!edgeId || vertexIndex === undefined || !originalVertexPosition || !startPos) return;
        const edge = stateRef.current.edges.find(e => e.id === edgeId);
        if (!edge || !edge.userVertices[vertexIndex]) return;

        const zoom = viewportRef.current.zoom;
        edge.userVertices[vertexIndex] = {
            x: originalVertexPosition.x + (screenPoint.x - startPos.x) / zoom,
            y: originalVertexPosition.y + (screenPoint.y - startPos.y) / zoom,
        };
        scheduleRender();
    }
}, []);

const screenToWorld = useCallback((canvasPoint: Point): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return canvasToWorld(viewportRef.current, canvas, canvasPoint);
}, []);

const clientToCanvas = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return clientToCanvasPoint(canvas.getBoundingClientRect(), canvas, clientX, clientY);
}, []);

  const worldToScreen = useCallback((worldPoint: Point): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const vp = viewportRef.current;
    const rect = canvas.getBoundingClientRect();
    // world -> canvas px -> CSS px relative to the canvas element
    return {
      x: ((worldPoint.x - vp.x) * vp.zoom + canvas.width / 2) * (rect.width / canvas.width),
      y: ((worldPoint.y - vp.y) * vp.zoom + canvas.height / 2) * (rect.height / canvas.height),
    };
  }, []);

  /** Every node for now; culling is disabled (see the TODO at the top of this file). */
  const getVisibleNodes = useCallback(() => {
    if (!canvasRef.current) return [];
    return state.nodes;
  }, [spatial, state.viewport, state.nodes.length, canvasRef]);
  
useLayoutEffect(() => {
   if (canvasRef.current && rendererRef.current?.initialized && rendererRef.current.getDeviceRef()) {
        rendererRef.current.attachCanvas(canvasRef.current);

  
  // This effect re-runs on every render (the spatial hook returns a new object each time),
  // so it must draw the *live* viewport. stateRef lags a render behind, and drawing from it
  // here would paint the pre-pan view right after a gesture commits.
  rendererRef.current.render(
      state.nodes,
      state.edges,
      viewportRef.current,
      { width: canvasRef.current.width, height: canvasRef.current.height },
      state.interaction.selectedNodes,
      state.interaction.selectedEdges,
      drawingStateRef.current
    );
  }}, [spatial]);

const scheduleRender = useCallback(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    const device = renderer?.getDeviceRef();
    if (!renderer?.initialized || !canvas || renderer.isBusy || renderer.isResizing) return;

    if (renderer.rafHandle) {
        cancelAnimationFrame(renderer.rafHandle);
    }

    renderer.rafHandle = requestAnimationFrame(() => {
      device?.pushErrorScope('validation');
      device?.pushErrorScope('out-of-memory');
        const s = stateRef.current;
        const vp = viewportRef.current;
        try {
            renderer.render(
                s.nodes,
                s.edges,
                vp,                     
                { width: canvas.width, height: canvas.height },
                s.interaction.selectedNodes,
                s.interaction.selectedEdges,
                drawingStateRef.current 
            );
        } catch (e) {
            console.error('WebGPU Render Error:', e);
        }
    });
}, []);

  /** Nodes under a point (canvas px). */
  const hitTestPoint = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    const hits = spatial.hitTest(worldPoint);
    return hits;
  }, [spatial, screenToWorld, state.viewport]);

  /** Like hitTestPoint, but a resize handle of the selected node takes priority. */
  const hitTestWithHandles = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    
    // Read stateRef so the callback never sees a stale selection
    const currentState = stateRef.current;
    
    // First check if we're hitting a resize handle of a selected node
    if (currentState.interaction.selectedNodes.length > 0) {
      const selectedNode = currentState.interaction.selectedNodes[0];
      
      // Ensure the node has the selected visual property set
      const nodeWithSelection = {
        ...selectedNode,
        visual: {
          ...selectedNode.visual,
          selected: true // handles are only hit-tested on selected nodes
        }
      };
      
      const resizeHandle = MouseInteractions.getResizeHandle(
        worldPoint,
        nodeWithSelection as any, 
        viewportRef.current
      );
      
      if (resizeHandle !== 'none') {
        return { nodes: [selectedNode], resizeHandle };
      }
    }
    
    // Then check for node hits
    const hits = spatial.hitTest(worldPoint);
    return { nodes: hits, resizeHandle: 'none' as ResizeHandle };
  }, [spatial, screenToWorld, stateRef]);

  // Node methods
  const addNode = useCallback((node: DiagramNode) => {
    dispatch({ type: 'ADD_NODE', node });
  }, []);

  const setAltKey = useCallback((pressed: boolean) => {
  dispatch({ type: 'SET_ALT_KEY', pressed });
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    dispatch({ type: 'REMOVE_NODE', nodeId });
  }, []);

  const updateNode = useCallback((node: DiagramNode) => {
    dispatch({ type: 'UPDATE_NODE', node });
  }, []);

  // Edge methods
  const addEdge = useCallback((edge: DiagramEdge) => {
    dispatch({ type: 'ADD_EDGE', edge });
  }, []);

  const removeEdge = useCallback((edgeId: string) => {
    dispatch({ type: 'REMOVE_EDGE', edgeId });
  }, []);

  const updateEdge = useCallback((edge: DiagramEdge) => {
    dispatch({ type: 'UPDATE_EDGE', edge });
  }, []);

  // Viewport methods
  // viewportRef is the source of truth while the user pans/zooms (gestures mutate it
  // per frame and only sync React state afterwards), so always merge onto it.
  const setViewport = useCallback((viewport: Partial<Viewport>) => {
    viewportRef.current = { ...viewportRef.current, ...viewport };
    dispatch({ type: 'SET_VIEWPORT', viewport: { ...viewportRef.current } });
  }, []);

  const viewAnimRef = useRef<number | null>(null);

  const cancelViewportAnimation = useCallback(() => {
    if (viewAnimRef.current !== null) {
      cancelAnimationFrame(viewAnimRef.current);
      viewAnimRef.current = null;
    }
  }, []);

  /** Eases the viewport to `target`. Zoom is interpolated geometrically so it feels even. */
  const animateViewportTo = useCallback((target: View, duration = 280) => {
    cancelViewportAnimation();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (duration <= 0 || reduceMotion) {
      setViewport(target);
      return;
    }
    const from = { ...viewportRef.current };
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const vp = viewportRef.current;
      vp.x = from.x + (target.x - from.x) * eased;
      vp.y = from.y + (target.y - from.y) * eased;
      vp.zoom = from.zoom * Math.pow(target.zoom / from.zoom, eased);
      scheduleRender();
      if (t < 1) {
        viewAnimRef.current = requestAnimationFrame(step);
      } else {
        viewAnimRef.current = null;
        setViewport(target); // sync React state once, at the end
      }
    };
    viewAnimRef.current = requestAnimationFrame(step);
  }, [cancelViewportAnimation, setViewport, scheduleRender]);

  useEffect(() => cancelViewportAnimation, [cancelViewportAnimation]);

  const fitToContent = useCallback(({ padding = 60, animate = true }: { padding?: number; animate?: boolean } = {}) => {
    const canvas = canvasRef.current;
    const { nodes, edges } = stateRef.current;
    const bounds = nodeBounds(nodes);
    if (!canvas || !bounds) return;

    // Routed edges can bulge past the nodes, so include their bend points.
    for (const edge of edges) {
      for (const v of edge.userVertices) {
        bounds.minX = Math.min(bounds.minX, v.x); bounds.maxX = Math.max(bounds.maxX, v.x);
        bounds.minY = Math.min(bounds.minY, v.y); bounds.maxY = Math.max(bounds.maxY, v.y);
      }
    }

    // Padding is in canvas pixels so the margin looks the same at any zoom.
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const fit = Math.min(Math.max(canvas.width - padding * 2, 1) / w, Math.max(canvas.height - padding * 2, 1) / h);
    // Don't blow a tiny graph up to fill the screen.
    const zoom = clampZoom(Math.min(fit, 1.5));
    const target = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom };

    if (animate) animateViewportTo(target);
    else { cancelViewportAnimation(); setViewport(target); }
  }, [animateViewportTo, cancelViewportAnimation, setViewport]);

  const setZoom = useCallback((zoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = { x: canvas.width / 2, y: canvas.height / 2 };
    animateViewportTo(zoomAbout(viewportRef.current, canvas, center, zoom), 160);
  }, [animateViewportTo]);

  const zoomBy = useCallback((factor: number) => setZoom(viewportRef.current.zoom * factor), [setZoom]);

  const setGridSnapping = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_GRID_SNAPPING', enabled });
  }, []);

  const applyLayout = useCallback(async (options: Partial<LayoutOptions> = {}) => {
    const { nodes, edges } = stateRef.current;
    const layout = await computeLayout(nodes, edges, { ...DEFAULT_LAYOUT_OPTIONS, ...options });
    // stateRef is updated by an effect, so patch it now for fitToContent.
    stateRef.current = {
      ...stateRef.current,
      nodes: nodes.map(n => {
        const position = layout.positions.get(n.id);
        return position ? { ...n, data: { ...n.data, position } } : n;
      }),
      edges: edges.map(e => ({ ...e, userVertices: layout.edgeVertices.get(e.id) ?? e.userVertices })),
    };
    dispatch({ type: 'APPLY_LAYOUT', layout });
    fitToContent({ animate: false });
  }, [fitToContent]);

  // Selection methods
  const selectNode = useCallback((node: DiagramNode | null) => {
    dispatch({ type: 'SELECT_NODE', node });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

const startDrag = useCallback((
    type: 'node' | 'viewport' | 'resize' | 'edge-vertex',
    screenPoint: Point,
    resizeHandle?: ResizeHandle,
    edgeID?: string,
    edgeVertexIndex?: number
) => {
    const selectedNode = stateRef.current.interaction.selectedNodes[0];

    let originalSize, originalPosition, originalVertexPosition;

    if (type === 'resize' && selectedNode) {
        originalSize = selectedNode.data.size 
            ? { ...selectedNode.data.size } 
            : { width: 100, height: 60 };
        originalPosition = selectedNode.data.position 
            ? { ...selectedNode.data.position } 
            : { x: 0, y: 0 };
    }

    if (type === 'edge-vertex' && edgeID && edgeVertexIndex !== undefined) {
        const edge = stateRef.current.edges.find(e => e.id === edgeID);
        if (edge?.userVertices[edgeVertexIndex]) {
            originalVertexPosition = { ...edge.userVertices[edgeVertexIndex] };
        }
    }

    interactionRef.current = {
        selectedEdges: interactionRef.current.selectedEdges,
        selectedNodes: interactionRef.current.selectedNodes,
        selectedVertex: interactionRef.current.selectedVertex,
        altKeyPressed: interactionRef.current.altKeyPressed,
        mode: interactionRef.current.mode,
        dragState: {
            isDragging: true,
            dragType: type,
            startPos: screenPoint,
            lastPos: screenPoint,
            resizeHandle,
            edgeId: edgeID,
            vertexIndex: edgeVertexIndex,
            originalSize,
            originalPosition,
            originalVertexPosition,
        }
    };
}, []);
const endDrag = useCallback(() => {
    const drag = interactionRef.current.dragState;
    const wasDragging = drag.isDragging;
    const type = drag.dragType;
    const edgeId = drag.edgeId;
    drag.isDragging = false;
    if (!wasDragging) return;

    const current = stateRef.current;
    const selected = current.interaction.selectedNodes[0];

    if (type === 'viewport') {
        // Sync the gesture-driven viewport ref back into React state
        dispatch({ type: 'SET_VIEWPORT', viewport: { ...viewportRef.current } });
    } else if ((type === 'node' || type === 'resize') && selected) {
        const stored = current.nodes.find(n => n.id === selected.id) ?? selected;
        // Snap the final position (not while dragging) unless Alt is held. Resizing keeps its exact geometry.
        if (type === 'node' && current.gridSnapping.enabled && !current.interaction.altKeyPressed) {
            stored.data.position = GridSnapping.snapPointToGrid(stored.data.position, current.gridSnapping.gridSize);
        }
        dispatch({ type: 'UPDATE_NODE', node: { ...stored } });
    } else if (type === 'edge-vertex' && edgeId) {
        const edge = current.edges.find(e => e.id === edgeId);
        if (edge) dispatch({ type: 'UPDATE_EDGE', edge: { ...edge, userVertices: [...edge.userVertices] } });
    }
    dispatch({ type: 'END_DRAG' });
}, []);
  // Renderer methods
  const getRenderer = useCallback(() => rendererRef.current, []);
  
  const isRendererInitialized = useCallback(() => {
    return rendererRef.current?.initialized || false;
  }, []);

  const renderFrame = useCallback(() => {
    scheduleRender();
  }, [scheduleRender]);

  // Debug methods
  const getSpatialDebugInfo = useCallback(() => {
    return spatial.getDebugInfo();
  }, [spatial]);

  useEffect(() => {
    if (state.interaction.selectedNodes.length > 0)
        
        (document.getElementById('title-ref') as HTMLTitleElement).textContent = ` WebGPU Flow | Selected node: ${state.interaction.selectedNodes[0].id}`;
    else {
      (document.getElementById('title-ref') as HTMLTitleElement).textContent = 'WebGPU Flow';
    }
  }, [state.nodes, state.interaction.selectedNodes, state.interaction.dragState, state.viewport]);

  // Rebuild spatial index when nodes change
  useEffect(() => {
    spatial.rebuild(state.nodes);
  }, [state.nodes, spatial]);

  // Schedule render when state changes
  useEffect(() => {
    scheduleRender();
  }, [state.viewport, state.nodes, state.edges]);

  // Cleanup on unmount
  useEffect(() => {
    setInitComplete(!initComplete);
    return () => {
      if (rendererRef.current) {
        rendererRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAltKey(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAltKey(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
  
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setAltKey]);

  const initializeRenderer = useCallback(async (canvas: HTMLCanvasElement): Promise<boolean> => {
    globalRenderer.onResizeComplete = () => scheduleRender();
    canvasRef.current = canvas;
    
    if (!rendererRef.current) {
        rendererRef.current = globalRenderer;
    }
    
    const success = globalRenderer.initialized;
    
    if (success) {
        await setViewport({ width: canvas.clientWidth, height: canvas.clientHeight });
        scheduleRender();
        return true;
    } else {
        console.warn('WebGPU initialization failed');
        return false;
    }
}, [scheduleRender, setViewport]);

 
  useEffect(() => {
    const checkSupersamplingSupport = async () => {
      const renderer = getRenderer();
      
      if (!renderer || !renderer.gpuCapibilitiesRef || !canvasRef.current) {
        return;
      }
      
      const currentWidth = canvasRef.current.width;
      const currentHeight = canvasRef.current.height;
      
      if (currentWidth === 0 || currentHeight === 0) {
        return;
      }
      
      const isInitialCheck = supportedSupersamplingFactors.length === 0;
      
      
      try {
        const support = await renderer.gpuCapibilitiesRef.checkSupersamplingSupport(
          currentWidth,
          currentHeight,
          parseInt(sampleCount)
        );
        
        setSupportedSupersamplingFactors(support.supportedFactors);
        setSupersamplingWarnings(support.warnings);
        
        
        if (!isInitialCheck && supersamplingValue !== 'Disabled') {
          const currentFactor = parseInt(supersamplingValue.replace('x', ''));
          if (!support.supportedFactors.includes(currentFactor)) {
            console.warn(`Supersampling ${currentFactor}x no longer supported, disabling`);
            setSuperSamplingValue('Disabled');
            await renderer.setSupersamplingFactor(1);
          }
        }
      } catch (error) {
        console.error('Failed to check supersampling support:', error);
        if (isInitialCheck) {
          // On initial check failure, set safe defaults
          setSupportedSupersamplingFactors([1]);
          setSupersamplingWarnings(['Failed to detect GPU capabilities']);
        }
      }
    };
    
    if (!canvasRef.current) return;
    getRenderer()?.updateDepthTextureOnSizeChange({width: canvasRef.current.width, height: canvasRef.current.height});
    const isInitialCheck = supportedSupersamplingFactors.length === 0;
    
    if (isInitialCheck) {
      const timeoutId = setTimeout(() => {
        checkSupersamplingSupport();
      }, 100);
      return () => clearTimeout(timeoutId);
    } else {
      const rafId = requestAnimationFrame(() => {
        checkSupersamplingSupport();
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [
    canvasRef.current?.width, 
    canvasRef.current?.height, 
    sampleCount,
    getRenderer,
    supportedSupersamplingFactors.length // non-zero once the first check has run
  ]);




  const toggleMode = useCallback(() => {

    setMode(prev => 
      prev === InteractionMode.SELECT 
        ? InteractionMode.DRAW_EDGE 
        : InteractionMode.SELECT
    );
  }, []);

  const exitDrawMode = useCallback(() => {
    setMode(InteractionMode.SELECT);
    setDrawingState({
      isDrawing: false,
      sourceNodeId: null,
      userVertices: []
    });
    
  }, []);

  const startDrawing = useCallback((nodeId: string) => {
    setDrawingState({
      isDrawing: true,
      sourceNodeId: nodeId,
      userVertices: [],
      style: { color: [0, 0, 1, 0.8],
        thickness: 2
      }
    });
  }, []);

const addControlPoint = useCallback((point: {x: number, y: number}, replaceLast?: boolean) => {
  setDrawingState(prev => {
    const newVertices = [...prev.userVertices];
    
    if (replaceLast && newVertices.length > 0) {
      // Update the last vertex (for mouse move preview)
      newVertices[newVertices.length - 1] = point;
    } else {
      // Add a new vertex (for mouse click)
      newVertices.push(point);
    }
    
    return {
      ...prev,
      userVertices: newVertices
    };
  });
}, []);

  const completeEdge = useCallback((targetNodeId: string): FloatingEdge | null => {
    if (!drawingState.sourceNodeId) return null;

    const newEdge: FloatingEdge = {
      id: `edge-${Date.now()}`,
      sourceNodeId: drawingState.sourceNodeId,
      targetNodeId: targetNodeId,
      userVertices: [...drawingState.userVertices],
      style: {
        color: [1, 1, 1, 1],
        thickness: 2
      }
    };


    // Reset drawing state
    setDrawingState({
      isDrawing: false,
      sourceNodeId: null,
      userVertices: []
    });

    return newEdge;
  }, [drawingState]);

  const cancelDrawing = useCallback(() => {
    setDrawingState({
      isDrawing: false,
      sourceNodeId: null,
      userVertices: []
    });
  }, []);

  // Delete and Escape. Mode shortcuts (V, E) belong to the Toolbar; handling them here
  // too would toggle twice per keypress.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focusedOnInput) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          if (mode === InteractionMode.DRAW_EDGE) {
            cancelDrawing();
          }
          else if (state.interaction.selectedEdges.length > 0) {
            if (state.interaction.selectedVertex) {
              removeEdgeVertex(
                state.interaction.selectedVertex.edgeId, 
                state.interaction.selectedVertex.vertexIndex
              );
              clearVertexSelection();
              clearEdgeSelection();
              return;
            }
            state.interaction.selectedEdges.forEach(edge => {
              removeEdge(edge.id);
            });
          }
          
          else if (state.interaction.selectedNodes.length > 0) {
            state.interaction.selectedNodes.forEach(node => {
              removeNode(node.id);
            });
          }

        } else if (e.key === 'Escape') {
          exitDrawMode();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, exitDrawMode, cancelDrawing, state.interaction, focusedOnInput, removeEdge, removeNode]);

const selectEdge = useCallback((edge: DiagramEdge | null) => {
  dispatch({ type: 'SELECT_EDGE', edge });
}, []);

const selectEdgeVertex = useCallback((edgeID: string, vertexIndex: number | null) => {
  dispatch({ type: 'SELECT_EDGE_VERTEX', edgeID, vertexIndex });
}, []);

const clearEdgeSelection = useCallback(() => {
  dispatch({ type: 'CLEAR_EDGE_SELECTION' });
}, []);

const clearVertexSelection = useCallback(() => {
  dispatch({ type: 'CLEAR_VERTEX_SELECTION' });
}, []);

const updateEdgeVertex = useCallback((edgeId: string, vertexIndex: number, newPosition: {x: number, y: number}) => {
  const edge = state.edges.find(e => e.id === edgeId);
  if (!edge) return;
  
  const updatedVertices = [...edge.userVertices];
  updatedVertices[vertexIndex] = newPosition;
  
  const updatedEdge = {
    ...edge,
    userVertices: updatedVertices,
  };
  
  updateEdge(updatedEdge);
}, [state.edges, updateEdge]);

const addEdgeVertex = useCallback((edgeId: string, position: {x: number, y: number}, insertAtIndex?: number) => {
  const edge = state.edges.find(e => e.id === edgeId);
  if (!edge) return;
  
  const updatedVertices = [...edge.userVertices];
  if (insertAtIndex !== undefined) {
    updatedVertices.splice(insertAtIndex, 0, position);
  } else {
    updatedVertices.push(position);
  }
  
  const updatedEdge = {
    ...edge,
    userVertices: updatedVertices,
  };
  
  updateEdge(updatedEdge);
}, [state.edges, updateEdge]);

const removeEdgeVertex = useCallback((edgeId: string, vertexIndex: number) => {
  const edge = state.edges.find(e => e.id === edgeId);
  if (!edge || edge.userVertices.length <= 0) return;
  
  const updatedVertices = edge.userVertices.filter((_, idx) => idx !== vertexIndex);
  
  const updatedEdge = {
    ...edge,
    userVertices: updatedVertices,
  };
  
  updateEdge(updatedEdge);
}, [state.edges, updateEdge]);


const hitTestEdgeVertex = useCallback((screenPoint: Point, edge: DiagramEdge): number => {
  const worldPoint = screenToWorld(screenPoint);
  const vertexSize = Math.max((12 * (viewportRef.current.pixelRatio ?? 1)) / viewportRef.current.zoom, 8);
  
  for (let i = 0; i < edge.userVertices.length; i++) {
    const vertex = edge.userVertices[i];
    const distance = Math.sqrt(
      Math.pow(worldPoint.x - vertex.x, 2) + 
      Math.pow(worldPoint.y - vertex.y, 2)
    );
    
    if (distance <= vertexSize) {
      return i;
    }
  }
  
  return -1;
}, [screenToWorld]);


  const handleSampleCountChange = useCallback(async (value: string) => {
    setSampleCount(value);
    const renderer = getRenderer();
    if (renderer) {
      await renderer.setSampleCount(value);
    }
    renderFrame();
  }, [getRenderer, renderFrame, sampleCount]);



  const handleSupersamplingChange = useCallback(async (value: string) => {
    setSuperSamplingValue(value);
    
    const renderer = getRenderer();
    if (renderer) {
      const factor = value === 'Disabled' ? 1 : parseInt(value.replace('x', ''));
      
      // Check if this factor is supported
      if (factor > 1 && !supportedSupersamplingFactors.includes(factor)) {
        console.error(`Supersampling factor ${factor}x is not supported!`);
        alert(`${factor}x supersampling is not supported on your GPU. Maximum supported: ${Math.max(...supportedSupersamplingFactors)}x`);
        return;
      }
      
      await renderer.setSupersamplingFactor(factor);
      
      if (factor > 1) {
        const sampleCountNum = parseInt(sampleCount);
        await renderer.supersamplingManager?.createSupersampledTextures(
          canvasRef.current!.width,
          canvasRef.current!.height,
          sampleCountNum
        );
      }
      
      renderFrame();
    }
  }, [getRenderer, renderFrame, sampleCount, supportedSupersamplingFactors]);


const hitTestEdge = useCallback((screenPoint: Point): {edge: DiagramEdge | null, vertexIndex: number, isVertex: boolean} => {
  const worldPoint = screenToWorld(screenPoint);
  // ~8 CSS pixels either side of the line, whatever the zoom.
  const threshold = (8 * (viewportRef.current.pixelRatio ?? 1)) / viewportRef.current.zoom;
  const nodesById = new Map(state.nodes.map(n => [n.id, n]));
  
  // Check vertices first (if any edge is selected)
  if (state.interaction.selectedEdges.length > 0) {
    const selectedEdge = state.interaction.selectedEdges[0];
    const vertexIndex = hitTestEdgeVertex(screenPoint, selectedEdge);
    if (vertexIndex !== -1) {
      return { edge: selectedEdge, vertexIndex, isVertex: true };
    }
  }
  
  // Check edge lines
  for (const edge of state.edges) {
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    
    if (!sourceNode || !targetNode) continue;
    
    // Build full path including source, vertices, and target
    const pathPoints = [
      sourceNode.data.position,
      ...edge.userVertices,
      targetNode.data.position,
    ];
    
    
    // Check each line segment
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = pathPoints[i];
      const p2 = pathPoints[i + 1];
      
      const distance = pointToLineDistance(worldPoint, p1, p2);
      if (distance < threshold) {
        return { edge, vertexIndex: -1, isVertex: false };
      }
    }
  }
  
  return { edge: null, vertexIndex: -1, isVertex: false };
}, [screenToWorld, hitTestEdgeVertex, state.interaction.selectedEdges, state.edges, state.nodes]);





/** Distance from a point to a line segment. */
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  
  if (lengthSquared === 0) {
    // Line segment is actually a point
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + 
      Math.pow(point.y - lineStart.y, 2)
    );
  }
  
  // Calculate projection of point onto line
  let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  
  const projectionX = lineStart.x + t * dx;
  const projectionY = lineStart.y + t * dy;
  
  return Math.sqrt(
    Math.pow(point.x - projectionX, 2) + 
    Math.pow(point.y - projectionY, 2)
  );

}


useEffect(() => {
  scheduleRender();
}, [setSampleCount, scheduleRender]);

  const supersamplingOptions = useMemo(() => [
    'Disabled',
    ...supportedSupersamplingFactors.filter(f => f > 1).map(f => `${f}x`)
  ], [supportedSupersamplingFactors]);

  
  const setFXAAEnabled = useCallback((enabled: boolean) => {
    setFXAAEnabledState(enabled);
    const renderer = getRenderer();
    if (renderer) {
      renderer.setFXAAEnabled(enabled);
    }
  }, [getRenderer]);

    
  const setSMAAEnabled = useCallback((enabled: boolean) => {
    setSMAAEnabledState(enabled);
    const renderer = getRenderer();
    if (renderer) {
      renderer.setSMAAEnabled(enabled);
    }
  }, [getRenderer]);





  // Context value
  const contextValue: DiagramContextValue = useMemo(() => ({
    ...state,
    interactionRef,
    viewportRef,
    fxaaEnabled,
    setFXAAEnabled,
    smaaEnabled,
    setSMAAEnabled,
    mode,
    supersamplingOptions,
    drawingState,
    toggleMode,
    setSampleCount,
    exitDrawMode,
    supportedSupersamplingFactors,
    supersamplingWarnings,
    startDrawing,
    addControlPoint,
    completeEdge,
    cancelDrawing,
    setAltKey,
    // Node methods
    addNode,
    removeNode,
    updateNode,
    // Edge methods  
    addEdge,
    removeEdge,
    updateEdge,
    applyLayout,
    fitToContent,
    zoomBy,
    setZoom,
    cancelViewportAnimation,
    setGridSnapping,
    selectEdgeVertex,
    // Spatial methods
    getVisibleNodes,
    hitTestPoint,
    hitTestWithHandles,
    // Viewport methods
    setViewport,
    screenToWorld,
    clientToCanvas,
    worldToScreen,
    // Selection methods
    selectNode,
    clearSelection,
    // Interaction methods
    startDrag,
    updateDrag,
    endDrag,
    addEdgeVertex,
    updateEdgeVertex,
    removeEdgeVertex,
    hitTestEdge,
    hitTestEdgeVertex,
    selectEdge,
    clearEdgeSelection,
    clearVertexSelection,
    // Renderer methods
    getRenderer,
    isRendererInitialized,
    initializeRenderer,
    renderFrame,
    // Debug methods
    getSpatialDebugInfo,
    handleSampleCountChange,
    handleSupersamplingChange,
    sampleCount,
    supersamplingValue,
    focusedOnInput,
    setFocusedOnInput
    
  }), [
    state,
    interactionRef,
    viewportRef,
    fxaaEnabled,
    setFXAAEnabled,
    smaaEnabled,
    setSMAAEnabled,
    mode,
    supersamplingOptions,
    drawingState,
    toggleMode,
    setSampleCount,
    exitDrawMode,
    supportedSupersamplingFactors,
    supersamplingWarnings,
    startDrawing,
    addControlPoint,
    completeEdge,
    cancelDrawing,
    setAltKey,
    addNode,
    removeNode,
    updateNode,
    addEdge,
    removeEdge,
    updateEdge,
    applyLayout,
    fitToContent,
    zoomBy,
    setZoom,
    cancelViewportAnimation,
    setGridSnapping,
    selectEdgeVertex,
    getVisibleNodes,
    hitTestPoint,
    hitTestWithHandles,
    setViewport,
    screenToWorld,
    clientToCanvas,
    worldToScreen,
    selectNode,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    addEdgeVertex,
    updateEdgeVertex,
    removeEdgeVertex,
    hitTestEdge,
    hitTestEdgeVertex,
    selectEdge,
    clearEdgeSelection,
    clearVertexSelection,
    getRenderer,
    isRendererInitialized,
    initializeRenderer,
    renderFrame,
    getSpatialDebugInfo,
    handleSampleCountChange,
    handleSupersamplingChange,
    sampleCount,
    supersamplingValue,
    focusedOnInput,
    setFocusedOnInput,
  ]);

  return (
    <DiagramContext.Provider value={contextValue}>
      {children}
    </DiagramContext.Provider>
  );
};

export const useDiagram = (): DiagramContextValue => {
  const context = useContext(DiagramContext);
  if (!context) {
    throw new Error('useDiagram must be used within a DiagramProvider');
  }
  return context;
};