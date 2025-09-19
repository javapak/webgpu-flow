import { useReducer, useEffect, useCallback, useMemo, useContext, createContext } from "react";
import { useSpatialIndex } from "../hooks/useSpatialIndex";
import type { Viewport, DiagramState, DiagramNode, DiagramEdge, InteractionState } from "../types";
import type { AABB, Point } from "../types/spatial-indexing/types";




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
  | { type: 'SELECT_NODES'; nodes: DiagramNode[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'START_DRAG'; dragType: 'node' | 'viewport' | 'selection'; startPos: Point }
  | { type: 'UPDATE_DRAG'; currentPos: Point }
  | { type: 'END_DRAG' }
  | { type: 'SET_MODE'; mode: InteractionState['mode'] };

export const diagramReducer = (state: DiagramState, action: DiagramAction): DiagramState => {
  switch (action.type) {
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

    case 'SET_VIEWPORT':
      return {
        ...state,
        viewport: { ...state.viewport, ...action.viewport },
      };

    case 'SELECT_NODE':
      return {
        ...state,
        interaction: {
          ...state.interaction,
          selectedNodes: action.node ? [action.node] : [],
        },
      };

    case 'CLEAR_SELECTION':
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

  const [state, dispatch] = useReducer(diagramReducer, initialState);
  const spatial = useSpatialIndex(initialBounds);

  // Sync spatial index with state changes
  useEffect(() => {
    spatial.rebuild(state.nodes);
  }, [state.nodes, spatial]);

  // Node methods
  const addNode = useCallback((node: DiagramNode) => {
    dispatch({ type: 'ADD_NODE', node });
    spatial.addNode(node);
  }, [spatial]);

  const removeNode = useCallback((nodeId: string) => {
    dispatch({ type: 'REMOVE_NODE', nodeId });
    spatial.removeNode(nodeId);
  }, [spatial]);

  const updateNode = useCallback((node: DiagramNode) => {
    dispatch({ type: 'UPDATE_NODE', node });
    spatial.updateNode(node);
  }, [spatial]);

  
  const addEdge = useCallback((edge: DiagramEdge) => {
    dispatch({ type: 'ADD_EDGE', edge });
  }, []);

  const removeEdge = useCallback((edgeId: string) => {
    dispatch({ type: 'REMOVE_EDGE', edgeId });
  }, []);

  const updateEdge = useCallback((edge: DiagramEdge) => {
    dispatch({ type: 'UPDATE_EDGE', edge });
  }, []);
  

  // Get only visible nodes for efficient rendering
  const getVisibleNodes = useCallback(() => {
    const viewportBounds: AABB = {
      minX: state.viewport.x - state.viewport.width / (2 * state.viewport.zoom),
      minY: state.viewport.y - state.viewport.height / (2 * state.viewport.zoom),
      maxX: state.viewport.x + state.viewport.width / (2 * state.viewport.zoom),
      maxY: state.viewport.y + state.viewport.height / (2 * state.viewport.zoom),
    };
    return spatial.getVisibleNodes(viewportBounds);
  }, [spatial, state.viewport]);

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

  // Hit testing using spatial index
  const hitTestPoint = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    return spatial.hitTest(worldPoint);
  }, [spatial, screenToWorld]);

  // Viewport methods
  const setViewport = useCallback((viewport: Partial<Viewport>) => {
    dispatch({ type: 'SET_VIEWPORT', viewport });
  }, []);

  // Selection methods
  const selectNode = useCallback((node: DiagramNode | null) => {
    dispatch({ type: 'SELECT_NODE', node });
  }, []);

  const selectNodes = useCallback((nodes: DiagramNode[]) => {
    dispatch({ type: 'SELECT_NODES', nodes });
  }, []);

  const clearSelection = useCallback(() => {
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

  // Mode methods
  const setMode = useCallback((mode: InteractionState['mode']) => {
    dispatch({ type: 'SET_MODE', mode });
  }, []);

  // Debug methods
  const getSpatialDebugInfo = useCallback(() => {
    return spatial.getDebugInfo();
  }, [spatial]);

  const contextValue: DiagramContextValue = useMemo(() => ({
    ...state,
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
    selectNodes,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    setMode,
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
    selectNodes,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    setMode,
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