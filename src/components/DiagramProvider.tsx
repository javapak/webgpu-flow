import { useReducer, useEffect, useCallback, useMemo, useContext, createContext, useRef, useState } from "react";
import { useSpatialIndex } from "../hooks/useSpatialIndex";
import { WebGPURenderer } from "../renderers/WebGPURenderer";
import { MouseInteractions, ResizeHandle } from "../utils/MouseInteractions";
import type { Viewport, DiagramState, DiagramNode, DiagramEdge, SpatialDiagramHook } from "../types";
import type { AABB, Point } from "../types/spatial-indexing/types";
import type { FloatingEdge } from "../renderers/FloatingEdgeRenderer";
import { GridSnapping } from '../utils/GridSnapping';

enum InteractionMode {
  SELECT = 'select',
  DRAW_EDGE = 'draw_edge'
}



export interface EdgeDrawingState {
  isDrawing: boolean;
  sourceNodeId: string | null;
  userVertices: Array<{x: number, y: number}>;
  style?: { color: [number, number, number, number]; thickness: number};
}


export interface DiagramContextValue extends DiagramState {
  // Spatial-aware methods
  addNode: (node: DiagramNode) => void;
  addEdge: (edge: DiagramEdge) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (node: DiagramNode) => void;
  updateEdge: (edge: DiagramEdge) => void;
  removeEdge: (edgeId: string) => void;
  selectEdge: (edge: DiagramEdge | null) => void;
  clearEdgeSelection: () => void;
  getVisibleNodes: () => DiagramNode[];
  hitTestPoint: (screenPoint: Point) => DiagramNode[];
  hitTestWithHandles: (screenPoint: Point) => { nodes: DiagramNode[]; resizeHandle: ResizeHandle };
  mode: InteractionMode;
  drawingState: EdgeDrawingState;
  toggleMode: () => void;
  exitDrawMode: () => void;
  startDrawing: (nodeId: string) => void;
  addControlPoint: (point: {x: number, y: number}, replaceLast?: boolean) => void;
  completeEdge: (targetNodeId: string) => FloatingEdge | null;
  cancelDrawing: () => void;

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
  setSampleCount: (sampleCount: string) => Promise<void>; 
  
  // Debug
  getSpatialDebugInfo: () => any;
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
  | { type: 'END_DRAG' };


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

    case 'UPDATE_DRAG':
      console.log('Dispatching UPDATE_DRAG:', 'vert index: ', state.interaction.dragState.vertexIndex, state.interaction.dragState.dragType);
      if (!state.interaction.dragState.isDragging) return state;
      
      const deltaX = action.currentPos.x - (state.interaction.dragState.lastPos?.x || 0);
      const deltaY = action.currentPos.y - (state.interaction.dragState.lastPos?.y || 0);

      if (state.interaction.dragState.dragType === 'viewport') {
        // Convert screen delta to world delta for viewport panning
        const worldDeltaX = deltaX / state.viewport.zoom;
        const worldDeltaY = deltaY / state.viewport.zoom;
        
        return {
          ...state,
          viewport: {
            ...state.viewport,
            x: state.viewport.x - worldDeltaX,
            y: state.viewport.y - worldDeltaY,
          },
          interaction: {
            ...state.interaction,
            dragState: {
              ...state.interaction.dragState,
              lastPos: action.currentPos,
            },
          },
        };
    } else if (
      state.interaction.dragState.dragType === 'node' &&
      state.interaction.selectedNodes.length > 0
    ) {
      const selectedNode = state.interaction.selectedNodes[0];
      const totalDeltaX = deltaX / state.viewport.zoom;
      const totalDeltaY = deltaY / state.viewport.zoom;

      const newPosition = {
        x: selectedNode.data.position.x + totalDeltaX,
        y: selectedNode.data.position.y + totalDeltaY
      };


      
      const updatedNode = {
        ...selectedNode,
        data: {
          ...selectedNode.data,
          position: newPosition,
        },
      };

      return {
        ...state,
        nodes: state.nodes.map(node =>
          node.id === selectedNode.id ? updatedNode : node
        ),
        interaction: {
          ...state.interaction,
          selectedNodes: [updatedNode],
          dragState: {
            ...state.interaction.dragState,
            lastPos: action.currentPos,
          },
        },
      };
      } else if (
        state.interaction.dragState.dragType === 'resize' &&
        state.interaction.selectedNodes.length > 0 &&
        state.interaction.dragState.resizeHandle &&
        state.interaction.dragState.originalSize &&
        state.interaction.dragState.originalPosition
      ) {
        // Handle resize logic
        const selectedNode = state.interaction.selectedNodes[0];
        const { resizeHandle, originalSize, originalPosition } = state.interaction.dragState;
        
        const totalDeltaX = (action.currentPos.x - state.interaction.dragState.startPos!.x) / state.viewport.zoom;
        const totalDeltaY = (action.currentPos.y - state.interaction.dragState.startPos!.y) / state.viewport.zoom;

        let newDimensions = MouseInteractions.calculateResize(
          resizeHandle,
          totalDeltaX,
          totalDeltaY,
          originalSize.width,
          originalSize.height,
          originalPosition.x,
          originalPosition.y,
          40, // minWidth
          30, // minHeight
          false
        );

        // Apply grid snapping if Alt is not pressed
        const shouldSnap = !state.interaction.altKeyPressed;
        if (shouldSnap) {
          newDimensions = GridSnapping.snapResize(
            newDimensions,
            state.gridSnapping.gridSize,
            40,
            30
          );
        }
        
        const updatedNode = {
          ...selectedNode,
          data: {
            ...selectedNode.data,
            position: {
              x: newDimensions.x,
              y: newDimensions.y,
            },
            size: {
              width: newDimensions.width,
              height: newDimensions.height,
            },
          },
          visual: {
            ...selectedNode.visual,
            selected: true,
            size: {
              width: newDimensions.width,
              height: newDimensions.height,
            }
          }
        };

        return {
          ...state,
          nodes: state.nodes.map(node =>
            node.id === selectedNode.id ? updatedNode : node
          ),
          interaction: {
            ...state.interaction,
            selectedNodes: [updatedNode],
            dragState: {
              ...state.interaction.dragState,
              lastPos: action.currentPos,
            },
          },
        };
      }

  // Handle edge vertex dragging
  else if (
    state.interaction.dragState.dragType === 'edge-vertex' &&
    state.interaction.dragState.edgeId &&
    state.interaction.dragState.vertexIndex !== undefined  // This is correct
  ) {
    console.log('🟣 Handling edge-vertex drag - ENTERED THIS BRANCH');
    const edgeId = state.interaction.dragState.edgeId;
    const vertexIndex = state.interaction.dragState.vertexIndex;
    const edge = state.edges.find(e => e.id === edgeId);
    
    console.log('🔵 UPDATE_DRAG for edge vertex:', {
      edgeId,
      vertexIndex,
      vertexIndexType: typeof vertexIndex,
      edgeFound: !!edge,
      currentPos: action.currentPos,
      lastPos: state.interaction.dragState.lastPos,
      deltaX,
      deltaY,
      zoom: state.viewport.zoom
    });
    
    if (!edge) {
      console.error('❌ Edge not found:', edgeId);
      return state;
    }
    
    if (vertexIndex >= edge.userVertices.length) {
      console.error('❌ Vertex index out of bounds:', vertexIndex, 'max:', edge.userVertices.length - 1);
      return state;
    }
    
    console.log('🔵 Current vertex position:', edge.userVertices[vertexIndex]);
    
    // Convert screen delta to world delta
    const worldDeltaX = deltaX / state.viewport.zoom;
    const worldDeltaY = deltaY / state.viewport.zoom;
    
    console.log('🔵 World delta:', { worldDeltaX, worldDeltaY });
    
    // Update the vertex position
    const updatedVertices = [...edge.userVertices];
    const newVertexPos = {
      x: edge.userVertices[vertexIndex].x + worldDeltaX,
      y: edge.userVertices[vertexIndex].y + worldDeltaY,
    };
    
    console.log('🔵 New vertex position:', newVertexPos);
    updatedVertices[vertexIndex] = newVertexPos;
    
    const updatedEdge = {
      ...edge,
      userVertices: updatedVertices,
    };
    
    console.log('🔵 Updated edge:', updatedEdge);
    console.log('🔵 All vertices after update:', updatedVertices);
    
    const newState = {
      ...state,
      edges: state.edges.map(e => {
        const isTarget = e.id === edgeId;
        console.log(`🔵 Mapping edge ${e.id}, isTarget: ${isTarget}`);
        return isTarget ? updatedEdge : e;
      }),
      interaction: {
        ...state.interaction,
        selectedEdges: [updatedEdge],
        dragState: {
          ...state.interaction.dragState,
          lastPos: action.currentPos,
        },
      },
    };
    
    console.log('🔵 New state edges:', newState.edges);
    console.log('🔵 Updated edge in new state:', newState.edges.find(e => e.id === edgeId));
    
    return newState;
  }
  return state;

  case 'END_DRAG':
  const shouldSnap = !state.interaction.altKeyPressed;
  
  if (shouldSnap && 
      state.interaction.dragState.dragType === 'node' &&
      state.interaction.selectedNodes.length > 0) {
    const selectedNode = state.interaction.selectedNodes[0];
    const snappedPosition = GridSnapping.snapPointToGrid(
      selectedNode.data.position,
      state.gridSnapping.gridSize
    );
    
    const snappedNode = {
      ...selectedNode,
      data: {
        ...selectedNode.data,
        position: snappedPosition,
      },
    };
    
    return {
      ...state,
      nodes: state.nodes.map(node =>
        node.id === selectedNode.id ? snappedNode : node
      ),
      interaction: {
        ...state.interaction,
        selectedNodes: [snappedNode],
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
  }  else if (
    state.interaction.dragState.dragType === 'edge-vertex' &&
    state.interaction.dragState.edgeId &&
    state.interaction.dragState.vertexIndex !== undefined  && shouldSnap // This is correct
  ) {
    const edgeId = state.interaction.dragState.edgeId;
    const vertexIndex = state.interaction.dragState.vertexIndex;
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) return state;
    if (vertexIndex >= edge.userVertices.length) return state;
   
      const currentVertexPos = edge.userVertices[vertexIndex];
      const snappedVertexPos = GridSnapping.snapPointToGrid(
        currentVertexPos,
        state.gridSnapping.gridSize
      );
      const updatedVertices = [...edge.userVertices];
      updatedVertices[vertexIndex] = snappedVertexPos;
      const updatedEdge = {
        ...edge,
        userVertices: updatedVertices,
      };
      return {  
        ...state,
        edges: state.edges.map(e =>
          e.id === edgeId ? updatedEdge : e
        ),
        interaction: {
          ...state.interaction,
          selectedEdges: [updatedEdge],
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
    }
     
  
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
  const rendererRef = useRef<WebGPURenderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state); // Keep current state in ref
  
  const [mode, setMode] = useState<InteractionMode>(InteractionMode.SELECT);
  const [drawingState, setDrawingState] = useState<EdgeDrawingState>({
    isDrawing: false,
    sourceNodeId: null,
    userVertices: []
  });

  // Update state ref whenever state changes
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Fixed coordinate transformation utilities
  const screenToWorld = useCallback((screenPoint: Point): Point => {
    // Use current state from ref to avoid stale closures
    const currentState = stateRef.current;
    // Convert screen coordinates to world coordinates
    // Screen origin (0,0) is top-left, world origin (0,0) is center
    const screenCenterX = currentState.viewport.width / 2;
    const screenCenterY = currentState.viewport.height / 2;
    
    // Convert screen point relative to center, then scale by zoom and add viewport offset
    const worldX = (screenPoint.x - screenCenterX) / currentState.viewport.zoom + currentState.viewport.x;
    const worldY = (screenPoint.y - screenCenterY) / currentState.viewport.zoom + currentState.viewport.y;
    
    return { x: worldX, y: worldY };
  }, [stateRef]);

  const worldToScreen = useCallback((worldPoint: Point): Point => {
    // Use current state from ref to avoid stale closures
    const currentState = stateRef.current;
    // Convert world coordinates to screen coordinates
    const screenCenterX = currentState.viewport.width / 2;
    const screenCenterY = currentState.viewport.height / 2;
    
    // Transform world point relative to viewport, scale by zoom, then offset to screen center
    const screenX = (worldPoint.x - currentState.viewport.x) * currentState.viewport.zoom + screenCenterX;
    const screenY = (worldPoint.y - currentState.viewport.y) * currentState.viewport.zoom + screenCenterY;
    
    return { x: screenX, y: screenY };
  }, [stateRef]);

  // Get only visible nodes for efficient rendering
  const getVisibleNodes = useCallback(() => {
    // Calculate viewport bounds in world coordinates
    const halfWidth = state.viewport.width / (2 * state.viewport.zoom);
    const halfHeight = state.viewport.height / (2 * state.viewport.zoom);
    
    const viewportBounds: AABB = {
      minX: state.viewport.x - halfWidth,
      minY: state.viewport.y - halfHeight,
      maxX: state.viewport.x + halfWidth,
      maxY: state.viewport.y + halfHeight,
    };
    
    const visible = spatial.getVisibleNodes(viewportBounds);
    return visible;
  }, [spatial, state.viewport, state.nodes.length]);

  // Simplified render scheduling
 const scheduleRender = useCallback(() => {
    if (rendererRef.current?.initialized && canvasRef.current) {
      // Use requestAnimationFrame to ensure we render with the LATEST state
      requestAnimationFrame(() => {
        if (!rendererRef.current?.initialized || !canvasRef.current) return;
        
        // Get fresh state values directly from ref
        const currentState = stateRef.current;
        
        // Calculate visible nodes with fresh state
        const halfWidth = currentState.viewport.width / (2 * currentState.viewport.zoom);
        const halfHeight = currentState.viewport.height / (2 * currentState.viewport.zoom);
        
        const viewportBounds: AABB = {
          minX: currentState.viewport.x - halfWidth,
          minY: currentState.viewport.y - halfHeight,
          maxX: currentState.viewport.x + halfWidth,
          maxY: currentState.viewport.y + halfHeight,
        };
        
        const visibleNodes = spatial.getVisibleNodes(viewportBounds);
        const visibleEdges = currentState.edges.filter((edge) => 
          visibleNodes.find((node) => node.id === edge.sourceNodeId || node.id === edge.targetNodeId));
      
        const canvasSize = {
          width: canvasRef.current!.width,
          height: canvasRef.current!.height,
        };
        
        try {
          rendererRef.current!.render(
            visibleNodes, 
            visibleEdges, 
            currentState.viewport, 
            canvasSize, 
            currentState.interaction.selectedNodes, 
            currentState.interaction.selectedEdges, 
            drawingState.isDrawing && drawingState.userVertices.length > 0 ? drawingState : undefined
          );
        } catch (error) {
          console.error('Render error:', error);
        }
      });
    }
  }, [spatial, drawingState]); // Depend on spatial and drawingState

  // Initialize renderer
  const initializeRenderer = useCallback(async (canvas: HTMLCanvasElement): Promise<boolean> => {
    canvasRef.current = canvas;
    
    if (!rendererRef.current) {
      rendererRef.current = new WebGPURenderer();
    }
    
    const success = await rendererRef.current.initialize(canvas);
    
    if (success) {
      scheduleRender();
      return true;
    } else {
      console.warn('WebGPU initialization failed');
      return false;
    }
  }, [scheduleRender]);

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
    dispatch({ 
      type: 'START_DRAG', 
      dragType: type, 
      startPos: screenPoint, 
      resizeHandle, 
      edgeId: edgeID, 
      vertexIndex: edgeVertexIndex
    });
  }, []);

  const updateDrag = useCallback((screenPoint: Point, isSnapped?: boolean) => {
    dispatch({ type: 'UPDATE_DRAG', currentPos: screenPoint, isSnapped});
  }, []);

  const endDrag = useCallback(() => {
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
        
        (document.getElementById('title-ref') as HTMLTitleElement).textContent = `Selected node: ${state.interaction.selectedNodes[0].id}`;
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
  }, [scheduleRender]);

  // Cleanup on unmount
  useEffect(() => {
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
      if (e.key === 'e' || e.key === 'E') {
        toggleMode();
      } else if (e.key === 'Escape') {
        exitDrawMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode, exitDrawMode]);

  const selectEdge = useCallback((edge: DiagramEdge | null) => {
  dispatch({ type: 'SELECT_EDGE', edge });
}, []);

const clearEdgeSelection = useCallback(() => {
  dispatch({ type: 'CLEAR_EDGE_SELECTION' });
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

const setSampleCount = useCallback(async (count: string) => {
  if (rendererRef.current) {
    await rendererRef.current.setSampleCount(count);
    scheduleRender();
  }
}, [scheduleRender]);





  // Context value
  const contextValue: DiagramContextValue = useMemo(() => ({
    ...state,
    mode,
    drawingState,
    toggleMode,
    setSampleCount,
    exitDrawMode,
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
    // Renderer methods
    getRenderer,
    isRendererInitialized,
    initializeRenderer,
    renderFrame,
    // Debug methods
    getSpatialDebugInfo,
  }), [
    state,
    addNode,
    removeNode,
    updateNode,
    addEdge,
    removeEdge,
    updateEdge,
    getVisibleNodes,
    hitTestPoint,
    hitTestWithHandles,
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