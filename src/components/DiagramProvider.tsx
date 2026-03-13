// NOTE TO-DO: DISABLED CULLING METHODS DUE TO BUGGY EDGES. NEED TO COME BACK TO FIX. 
// (example - node gets culled for being non visible, 
// but because node gets cullled and may be a source or target node, 
// the edge also gets culled even if the edge also points to an on-screen node.)

import { useReducer, useEffect, useCallback, useMemo, useContext, createContext, useRef, useState, useLayoutEffect } from "react";
import { useSpatialIndex } from "../hooks/useSpatialIndex";
import { WebGPURenderer } from "../renderers/WebGPURenderer";
import { MouseInteractions, type ResizeHandle } from "../utils/MouseInteractions";
import type { Viewport, DiagramState, DiagramNode, DiagramEdge, SpatialDiagramHook, InteractionState } from "../types";
import type { AABB, Point } from "../types/spatial-indexing/types";
import type { FloatingEdge } from "../renderers/FloatingEdgeRenderer";
import { GridSnapping } from '../utils/GridSnapping';
import globalRenderer from '../../../webgpu-flow/src/renderers/gpuInstance'

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
  hitTestEdgeVertex: (screenPoint: Point, edge: DiagramEdge) => number; // returns vertex index or -1
  
  // Viewport methods
  setViewport: (viewport: Partial<DiagramState['viewport']>) => void;
  screenToWorld: (screenPoint: Point) => Point;
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
  const stateRef = useRef(state); // Keep current state in ref
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


const viewportRef = useRef({
    x: 0, y: 0, zoom: 1,
    width: 800, height: 600,
});

const drawingStateRef = useRef<EdgeDrawingState>({isDrawing: false, sourceNodeId: null, userVertices: []});

  // Update state ref whenever state changes
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    viewportRef.current = state.viewport;
}, [state.viewport]);


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
    }
}, []);

const screenToWorld = useCallback((screenPoint: Point): Point => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const vp = viewportRef.current; 
    
    const scaleX = (canvas.width / rect.width) * 0.7;
    const scaleY = (canvas.height / rect.height) * 0.7;
    
    const canvasX = screenPoint.x * scaleX;
    const canvasY = screenPoint.y * scaleY;
    
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    
    const worldX = (canvasX - canvasCenterX) / vp.zoom + vp.x;
    const worldY = (canvasY - canvasCenterY) / vp.zoom + vp.y;
    
    return { x: worldX, y: worldY };
}, []); 

  const worldToScreen = useCallback((worldPoint: Point): Point => {
    const currentState = stateRef.current;
    
    if (!canvasRef.current) {
      return { x: 0, y: 0 };
    }
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Convert world to canvas coordinates
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    
    const canvasX = (worldPoint.x - currentState.viewport.x) * currentState.viewport.zoom + canvasCenterX;
    const canvasY = (worldPoint.y - currentState.viewport.y) * currentState.viewport.zoom + canvasCenterY;
    
    // Convert canvas to screen coordinates
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    
    const screenX = canvasX * scaleX;
    const screenY = canvasY * scaleY;
    
    return { x: screenX, y: screenY };
  }, [stateRef, canvasRef]);

  // Get only visible nodes for efficient rendering
  const getVisibleNodes = useCallback(() => {
    if (!canvasRef.current) return [];
    
    // Calculate viewport bounds in world coordinates using canvas dimensions
    // const canvas = canvasRef.current;
    //const halfWidth = canvas.width / (2 * state.viewport.zoom);
    //const halfHeight = canvas.height / (2 * state.viewport.zoom);
    
    /*const viewportBounds: AABB = {
      minX: state.viewport.x - halfWidth,
      minY: state.viewport.y - halfHeight,
      maxX: state.viewport.x + halfWidth,
      maxY: state.viewport.y + halfHeight,
    }; */
    
    //const visible = spatial.getVisibleNodes(viewportBounds);
    return state.nodes;
  }, [spatial, state.viewport, state.nodes.length, canvasRef]);
  
useLayoutEffect(() => {
   if (canvasRef.current && rendererRef.current?.initialized && rendererRef.current.getDeviceRef()) {
        rendererRef.current.attachCanvas(canvasRef.current);

  
  const currentState = stateRef.current;
  rendererRef.current.render(
      state.nodes, // for now we render it all.
      currentState.edges,
      currentState.viewport,
      { width: canvasRef.current.width, height: canvasRef.current.height }
      
    );
  }}, [spatial]);




/*const performSyncRender = useCallback(() => {
  const renderer = rendererRef.current;
  const canvas = canvasRef.current;
  const currentState = stateRef.current;

  if (!renderer?.initialized || !canvas) return;

  try {
    renderer.render(
      spatial.getVisibleNodes({
        minX: currentState.viewport.x - canvas.width / (2 * currentState.viewport.zoom),
        minY: currentState.viewport.y - canvas.height / (2 * currentState.viewport.zoom),
        maxX: currentState.viewport.x + canvas.width / (2 * currentState.viewport.zoom),
        maxY: currentState.viewport.y + canvas.height / (2 * currentState.viewport.zoom),
      }),
      currentState.edges,
      currentState.viewport,
      { width: canvas.width, height: canvas.height },
    );
  } catch (e) {
    console.error("Initial render failed", e);
  }
}, [spatial]); */

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
      console.log('yo im mothafuckin raf');
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

  // Enhanced hit testing that also checks for resize handles
  const hitTestPoint = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    const hits = spatial.hitTest(worldPoint);
    return hits;
  }, [spatial, screenToWorld, state.viewport]);

  // Separate function for enhanced hit testing with resize handles
  const hitTestWithHandles = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    
    // Use the most current state from stateRef to avoid stale closures
    const currentState = stateRef.current;
    
    // First check if we're hitting a resize handle of a selected node
    if (currentState.interaction.selectedNodes.length > 0) {
      const selectedNode = currentState.interaction.selectedNodes[0];
      
      // Ensure the node has the selected visual property set
      const nodeWithSelection = {
        ...selectedNode,
        visual: {
          ...selectedNode.visual,
          selected: true // Force this to be true for hit testing
        }
      };
      
      const resizeHandle = MouseInteractions.getResizeHandle(
        worldPoint,
        nodeWithSelection as any, 
        currentState.viewport
      );
      
      if (resizeHandle !== 'none') {
        return { nodes: [selectedNode], resizeHandle };
      }
    }
    
    // Then check for node hits
    const hits = spatial.hitTest(worldPoint);
    return { nodes: hits, resizeHandle: 'none' as ResizeHandle };
  }, [spatial, screenToWorld, stateRef]); // Use stateRef instead of state dependencies

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
  const setViewport = useCallback((viewport: Partial<Viewport>) => {
    dispatch({ type: 'SET_VIEWPORT', viewport });
  }, []);

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
    const drag = interactionRef.current;
    drag.dragState.isDragging = false;

    if (drag.dragState.dragType === 'viewport') {
        // Flush viewport ref back into reducer so rest of app sees it
        dispatch({ 
            type: 'SET_VIEWPORT', 
            viewport: { ...viewportRef.current } 
        });

    } else if (drag.dragState.dragType === 'node') {
        const selectedNode = stateRef.current.interaction.selectedNodes[0];
        if (!selectedNode) return;

        // Apply grid snapping on release
        const snapped = !stateRef.current.interaction.altKeyPressed
            ? GridSnapping.snapPointToGrid(
                selectedNode.data.position,
                stateRef.current.gridSnapping.gridSize
              )
            : selectedNode.data.position;

        selectedNode.data.position = snapped;

        // Flush back to reducer
        dispatch({ type: 'UPDATE_NODE', node: { ...selectedNode } });
        dispatch({ type: 'END_DRAG' });
    } else {
        dispatch({ type: 'END_DRAG' });
    }
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
        
        (document.getElementById('title-ref') as HTMLTitleElement).textContent = ` EFTA Explorer | Selected node: ${state.interaction.selectedNodes[0].id}`;
    else {
      (document.getElementById('title-ref') as HTMLTitleElement).textContent = 'EFTA Explorer';
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

    // Check supersampling support when canvas size or MSAA changes
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
        console.log('Waiting for initialization...');
        return;
      }
      
      const currentWidth = canvasRef.current.width;
      const currentHeight = canvasRef.current.height;
      
      if (currentWidth === 0 || currentHeight === 0) {
        console.log('Waiting for valid canvas dimensions...');
        return;
      }
      
      const isInitialCheck = supportedSupersamplingFactors.length === 0;
      
      console.log(
        isInitialCheck 
          ? `Initial supersampling check: ${currentWidth}x${currentHeight}` 
          : `Rechecking supersampling: ${currentWidth}x${currentHeight}`
      );
      
      try {
        const support = await renderer.gpuCapibilitiesRef.checkSupersamplingSupport(
          currentWidth,
          currentHeight,
          parseInt(sampleCount)
        );
        
        setSupportedSupersamplingFactors(support.supportedFactors);
        setSupersamplingWarnings(support.warnings);
        
        console.log(isInitialCheck ? '✓ Initial support loaded' : '✓ Support updated', {
          supported: support.supportedFactors,
          maxFactor: support.maxFactor,
          warnings: support.warnings.length
        });
        
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
    supportedSupersamplingFactors.length // Tracks if initial check is done
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
    // Create a new array to avoid mutation
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

    console.log('completed edge: ', newEdge);

    // Reset drawing state
    setDrawingState({
      isDrawing: false,
      sourceNodeId: null,
      userVertices: []
    });
    console.log('completed edge: ', newEdge);

    return newEdge;
  }, [drawingState]);

  const cancelDrawing = useCallback(() => {
    setDrawingState({
      isDrawing: false,
      sourceNodeId: null,
      userVertices: []
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focusedOnInput) {
        if (e.key === 'e' || e.key === 'E') {
          toggleMode();
        }
        else if (e.key === 'Backspace' || e.key === 'Delete') {
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
  }, [toggleMode, exitDrawMode, cancelDrawing, state.interaction, focusedOnInput, removeEdge, removeNode]);

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
  if (!edge || edge.userVertices.length <= 0) return; // Keep at least one vertex for valid edge
  
  const updatedVertices = edge.userVertices.filter((_, idx) => idx !== vertexIndex);
  
  const updatedEdge = {
    ...edge,
    userVertices: updatedVertices,
  };
  
  updateEdge(updatedEdge);
}, [state.edges, updateEdge]);

// Add hit testing for edges:

const hitTestEdgeVertex = useCallback((screenPoint: Point, edge: DiagramEdge): number => {
  const worldPoint = screenToWorld(screenPoint);
  const vertexSize = Math.max(12 / state.viewport.zoom, 8);
  
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
}, [screenToWorld, state.viewport.zoom]);


  const handleSampleCountChange = useCallback(async (value: string) => {
    setSampleCount(value);
    const renderer = getRenderer();
    if (renderer) {
      await renderer.setSampleCount(value);
    }
    renderFrame();
  }, [getRenderer, renderFrame, sampleCount]);



  const handleSupersamplingChange = useCallback(async (value: string) => {
    console.log('Changing supersampling to:', value);
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
  const threshold = 5; 
  
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
    const sourceNode = state.nodes.find(n => n.id === edge.sourceNodeId);
    const targetNode = state.nodes.find(n => n.id === edge.targetNodeId);
    
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
}, [screenToWorld, hitTestEdgeVertex, state.viewport.zoom, state.interaction.selectedEdges, state.edges, state.nodes]);





// Helper function for point-to-line distance
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

  const supersamplingOptions = [
    'Disabled',
    ...supportedSupersamplingFactors.filter(f => f > 1).map(f => `${f}x`)
  ];

  
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
    selectEdgeVertex,
    // Spatial methods
    getVisibleNodes,
    hitTestPoint, // Keep the basic version for compatibility
    hitTestWithHandles, // Add the enhanced version
    // Viewport methods
    setViewport,
    screenToWorld,
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
    addNode,
    removeNode,
    updateNode,
    selectEdgeVertex,
    addEdge,
    removeEdge,
    updateEdge,
    getVisibleNodes,
    hitTestPoint,
    hitTestWithHandles,
    focusedOnInput,
    setFocusedOnInput,
    setViewport,
    screenToWorld,
    worldToScreen,
    selectNode,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    getRenderer,
    isRendererInitialized,
    initializeRenderer,
    renderFrame,
    getSpatialDebugInfo,
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