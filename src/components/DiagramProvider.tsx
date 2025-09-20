import { useReducer, useEffect, useCallback, useMemo, useContext, createContext, useRef } from "react";
import { useSpatialIndex, type SpatialDiagramHook } from "../hooks/useSpatialIndex";
import { WebGPURenderer } from "../renderers/WebGPURenderer";
import type { Viewport, DiagramState, DiagramNode, DiagramEdge, InteractionState } from "../types";
import type { AABB, Point } from "../types/spatial-indexing/types";
import { DebugWebGPURenderer } from "../renderers/DebugWebGPURenderer";

export interface DiagramContextValue extends DiagramState {
  // Spatial-aware methods
  addNode: (node: DiagramNode) => void;
  addEdge: (edge: DiagramEdge) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (node: DiagramNode) => void;
  getVisibleNodes: () => DiagramNode[];
  hitTestPoint: (screenPoint: Point) => DiagramNode[];
  
  // Viewport methods
  setViewport: (viewport: Partial<DiagramState['viewport']>) => void;
  screenToWorld: (screenPoint: Point) => Point;
  worldToScreen: (worldPoint: Point) => Point;
  
  // Selection methods
  selectNode: (node: DiagramNode | null) => void;
  clearSelection: () => void;
  
  // Interaction methods
  startDrag: (type: 'node' | 'viewport', screenPoint: Point) => void;
  updateDrag: (screenPoint: Point) => void;
  endDrag: () => void;
  
  // Renderer methods
  getRenderer: () => WebGPURenderer | null;
  isRendererInitialized: () => boolean;
  initializeRenderer: (canvas: HTMLCanvasElement) => Promise<boolean>;
  renderFrame: () => void;
  
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
  | { type: 'CLEAR_SELECTION' }
  | { type: 'START_DRAG'; dragType: 'node' | 'viewport' | 'selection'; startPos: Point }
  | { type: 'UPDATE_DRAG'; currentPos: Point }
  | { type: 'END_DRAG' };

export const diagramReducer = (state: DiagramState, action: DiagramAction): DiagramState => {
  console.log('Reducer action:', action.type, action);
  
  switch (action.type) {
    case 'ADD_NODE':
      console.log('Adding node to state:', action.node);
      return {
        ...state,
        nodes: [...state.nodes, action.node],
      };

    case 'REMOVE_NODE':
      console.log('Removing node from state:', action.nodeId);
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
      console.log('Updating node in state:', action.node);
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
      console.log('Selecting node:', action.node?.id || 'none');
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedNodes: action.node ? [action.node] : [],
        },
      };

    case 'CLEAR_SELECTION':
      console.log('Clearing selection');
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedNodes: [],
        },
      };

    case 'START_DRAG':
      return {
        ...state,
        interaction: {
          ...state.interaction,
          dragState: {
            isDragging: true,
            dragType: action.dragType,
            startPos: action.startPos,
            lastPos: action.startPos,
          },
        },
      };

    case 'UPDATE_DRAG':
      if (!state.interaction.dragState.isDragging) return state;
      
      const deltaX = action.currentPos.x - (state.interaction.dragState.lastPos?.x || 0);
      const deltaY = action.currentPos.y - (state.interaction.dragState.lastPos?.y || 0);

      if (state.interaction.dragState.dragType === 'viewport') {
        return {
          ...state,
          viewport: {
            ...state.viewport,
            x: state.viewport.x - deltaX / state.viewport.zoom,
            y: state.viewport.y - deltaY / state.viewport.zoom,
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
        const updatedNode = {
          ...selectedNode,
          data: {
            ...selectedNode.data,
            position: {
              x: selectedNode.data.position.x + deltaX / state.viewport.zoom,
              y: selectedNode.data.position.y + deltaY / state.viewport.zoom,
            },
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
      }

      return state;

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
      dragState: {
        isDragging: false,
        dragType: null,
        startPos: null,
        lastPos: null,
      },
      mode: 'select',
    },
  };

  // State and refs
  const [state, dispatch] = useReducer(diagramReducer, initialState);
  const spatial: SpatialDiagramHook = useSpatialIndex(initialBounds);
  const rendererRef = useRef<WebGPURenderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderScheduledRef = useRef<boolean>(false);
  const stateRef = useRef(state); // Keep current state in ref

  // Update state ref whenever state changes
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Coordinate transformation utilities
  const screenToWorld = useCallback((screenPoint: Point): Point => {
    return {
      x: (screenPoint.x - state.viewport.width / 2) / state.viewport.zoom + state.viewport.x,
      y: (screenPoint.y - state.viewport.height / 2) / state.viewport.zoom + state.viewport.y,
    };
  }, [state.viewport]);

  const worldToScreen = useCallback((worldPoint: Point): Point => {
    return {
      x: (worldPoint.x - state.viewport.x) * state.viewport.zoom + state.viewport.width / 2,
      y: (worldPoint.y - state.viewport.y) * state.viewport.zoom + state.viewport.height / 2,
    };
  }, [state.viewport]);

  // Get only visible nodes for efficient rendering
  const getVisibleNodes = useCallback(() => {
    const viewportBounds: AABB = {
      minX: state.viewport.x - state.viewport.width / (2 * state.viewport.zoom),
      minY: state.viewport.y - state.viewport.height / (2 * state.viewport.zoom),
      maxX: state.viewport.x + state.viewport.width / (2 * state.viewport.zoom),
      maxY: state.viewport.y + state.viewport.height / (2 * state.viewport.zoom),
    };
    const visible = spatial.getVisibleNodes(viewportBounds);
    console.log('getVisibleNodes:', { 
      bounds: viewportBounds, 
      total: state.nodes.length, 
      visible: visible.length,
      visibleIds: visible.map(n => n.id)
    });
    return visible;
  }, [spatial, state.viewport, state.nodes.length]);

  // Simplified render scheduling
  const scheduleRender = useCallback(() => {
    if (rendererRef.current?.initialized && canvasRef.current) {
      // Get fresh state values directly
      const currentState = stateRef.current;
      
      // Calculate visible nodes with fresh state
      const viewportBounds: AABB = {
        minX: currentState.viewport.x - currentState.viewport.width / (2 * currentState.viewport.zoom),
        minY: currentState.viewport.y - currentState.viewport.height / (2 * currentState.viewport.zoom),
        maxX: currentState.viewport.x + currentState.viewport.width / (2 * currentState.viewport.zoom),
        maxY: currentState.viewport.y + currentState.viewport.height / (2 * currentState.viewport.zoom),
      };
      const visibleNodes = spatial.getVisibleNodes(viewportBounds);
      
      const canvasSize = {
        width: canvasRef.current.width,
        height: canvasRef.current.height,
      };
      
      console.log('WebGPU Render (Direct):', {
        totalNodes: currentState.nodes.length,
        visibleNodes: visibleNodes.length,
        selectedNodes: currentState.interaction.selectedNodes.length,
        viewport: currentState.viewport
      });
      
      try {
        rendererRef.current.render(currentState.nodes, currentState.viewport, canvasSize, currentState.interaction.selectedNodes);
      } catch (error) {
        console.error('Render error:', error);
      }
    }
  }, [spatial]); // Only depend on spatial

  // Initialize renderer
  const initializeRenderer = useCallback(async (canvas: HTMLCanvasElement): Promise<boolean> => {
    console.log('Initializing WebGPU renderer...');
    canvasRef.current = canvas;
    
    if (!rendererRef.current) {
      rendererRef.current = new WebGPURenderer();
    }
    
    const success = await rendererRef.current.initialize(canvas);
    
    if (success) {
      console.log('WebGPU renderer initialized successfully');
      scheduleRender();
      return true;
    } else {
      console.warn('WebGPU initialization failed');
      return false;
    }
  }, [scheduleRender]);

  // Hit testing using spatial index
  const hitTestPoint = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    const hits = spatial.hitTest(worldPoint);
    console.log('hitTestPoint:', { screenPoint, worldPoint, hits: hits.length, hitIds: hits.map(n => n.id) });
    return hits;
  }, [spatial, screenToWorld]);

  // Node methods
  const addNode = useCallback((node: DiagramNode) => {
    console.log('DiagramProvider.addNode called:', node);
    dispatch({ type: 'ADD_NODE', node });
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    console.log('DiagramProvider.removeNode called:', nodeId);
    dispatch({ type: 'REMOVE_NODE', nodeId });
  }, []);

  const updateNode = useCallback((node: DiagramNode) => {
    console.log('DiagramProvider.updateNode called:', node);
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
    console.log('selectNode called:', node?.id || 'null');
    dispatch({ type: 'SELECT_NODE', node });
  }, []);

  const clearSelection = useCallback(() => {
    console.log('clearSelection called');
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  // Interaction methods
  const startDrag = useCallback((type: 'node' | 'viewport' | 'selection', screenPoint: Point) => {
    dispatch({ type: 'START_DRAG', dragType: type, startPos: screenPoint });
  }, []);

  const updateDrag = useCallback((screenPoint: Point) => {
    dispatch({ type: 'UPDATE_DRAG', currentPos: screenPoint });
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

  // Effects
  // Log state changes
  useEffect(() => {
    console.log('State updated:', {
      nodeCount: state.nodes.length,
      selectedCount: state.interaction.selectedNodes.length,
      nodes: state.nodes.map(n => ({ id: n.id, pos: n.data.position })),
      selected: state.interaction.selectedNodes.map(n => n.id)
    });
  }, [state.nodes, state.interaction.selectedNodes]);

  // Rebuild spatial index when nodes change
  useEffect(() => {
    console.log('Rebuilding spatial index with', state.nodes.length, 'nodes');
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

  // Context value
  const contextValue: DiagramContextValue = useMemo(() => ({
    ...state,
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
    hitTestPoint,
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