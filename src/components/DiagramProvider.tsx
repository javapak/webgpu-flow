import { useReducer, useEffect, useCallback, useMemo, useContext, createContext, useRef } from "react";
import { useSpatialIndex, type SpatialDiagramHook } from "../hooks/useSpatialIndex";
import { WebGPURenderer } from "../renderers/WebGPURenderer";
import { MouseInteractions, type ResizeHandle } from "../utils/MouseInteractions";
import type { Viewport, DiagramState, DiagramNode, DiagramEdge } from "../types";
import type { AABB, Point } from "../types/spatial-indexing/types";

export interface DiagramContextValue extends DiagramState {
  // Spatial-aware methods
  addNode: (node: DiagramNode) => void;
  addEdge: (edge: DiagramEdge) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (node: DiagramNode) => void;
  getVisibleNodes: () => DiagramNode[];
  hitTestPoint: (screenPoint: Point) => DiagramNode[];
  hitTestWithHandles: (screenPoint: Point) => { nodes: DiagramNode[]; resizeHandle: ResizeHandle };
  
  // Viewport methods
  setViewport: (viewport: Partial<DiagramState['viewport']>) => void;
  screenToWorld: (screenPoint: Point) => Point;
  worldToScreen: (worldPoint: Point) => Point;
  
  // Selection methods
  selectNode: (node: DiagramNode | null) => void;
  clearSelection: () => void;
  
  // Interaction methods
  startDrag: (type: 'node' | 'viewport' | 'resize', screenPoint: Point, resizeHandle?: ResizeHandle) => void;
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
  | { type: 'START_DRAG'; dragType: 'node' | 'viewport' | 'resize'; startPos: Point; resizeHandle?: ResizeHandle }
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

    case 'CLEAR_SELECTION':
      console.log('Clearing selection');
      
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

    case 'START_DRAG':
      const selectedNode = state.interaction.selectedNodes[0];
      
      console.log('🚀 Starting drag:', {
        dragType: action.dragType,
        resizeHandle: action.resizeHandle,
        selectedNode: selectedNode?.id,
        startPos: action.startPos
      });
      
      // For resize operations, capture the original size and position
      let originalSize, originalPosition;
      if (action.dragType === 'resize' && selectedNode) {
        originalSize = selectedNode.data.size ? { ...selectedNode.data.size } : { width: 100, height: 60 };
        originalPosition = selectedNode.data.position ? { ...selectedNode.data.position } : { x: 0, y: 0 };
        
        console.log('🚀 Resize drag setup:', {
          originalSize,
          originalPosition,
          resizeHandle: action.resizeHandle
        });
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
            resizeHandle: action.resizeHandle,
            originalSize,
            originalPosition,
          },
        },
      };

    case 'UPDATE_DRAG':
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
        // Convert screen delta to world delta for node movement
        const worldDeltaX = deltaX / state.viewport.zoom;
        const worldDeltaY = deltaY / state.viewport.zoom;
        
        const updatedNode = {
          ...selectedNode,
          data: {
            ...selectedNode.data,
            position: {
              x: selectedNode.data.position.x + worldDeltaX,
              y: selectedNode.data.position.y + worldDeltaY,
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
        
        console.log('🔄 Processing resize drag:', {
          resizeHandle,
          originalSize,
          originalPosition,
          currentPos: action.currentPos,
          startPos: state.interaction.dragState.startPos,
          deltaX: action.currentPos.x - (state.interaction.dragState.startPos?.x || 0),
          deltaY: action.currentPos.y - (state.interaction.dragState.startPos?.y || 0)
        });
        
        // Convert screen delta to world delta for resizing
        const worldDeltaX = deltaX / state.viewport.zoom;
        const worldDeltaY = deltaY / state.viewport.zoom;
        
        // Calculate cumulative delta from start position
        const totalDeltaX = (action.currentPos.x - state.interaction.dragState.startPos!.x) / state.viewport.zoom;
        const totalDeltaY = (action.currentPos.y - state.interaction.dragState.startPos!.y) / state.viewport.zoom;
        
        console.log('🔄 Resize deltas:', {
          screenDelta: { x: deltaX, y: deltaY },
          worldDelta: { x: worldDeltaX, y: worldDeltaY },
          totalDelta: { x: totalDeltaX, y: totalDeltaY }
        });
        
        // Check if this shape should lock aspect ratio
        
        
        console.log('🔄 Calling calculateResize with:', {
          handle: resizeHandle,
          totalDeltaX,
          totalDeltaY,
          originalSize,
          originalPosition,
          lockAspectRatio: false
        });
        
        const newDimensions = MouseInteractions.calculateResize(
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
        
        console.log('🔄 New dimensions calculated:', newDimensions);
        
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
            selected: true, // Maintain selection
            size: {
              width: newDimensions.width,
              height: newDimensions.height,
            }
          }
        };

        console.log('🔄 Updated node:', updatedNode);

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
            resizeHandle: undefined,
            originalSize: undefined,
            originalPosition: undefined,
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
  const stateRef = useRef(state); // Keep current state in ref

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
    console.log('getVisibleNodes:', { 
      viewport: state.viewport,
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
      const halfWidth = currentState.viewport.width / (2 * currentState.viewport.zoom);
      const halfHeight = currentState.viewport.height / (2 * currentState.viewport.zoom);
      
      const viewportBounds: AABB = {
        minX: currentState.viewport.x - halfWidth,
        minY: currentState.viewport.y - halfHeight,
        maxX: currentState.viewport.x + halfWidth,
        maxY: currentState.viewport.y + halfHeight,
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
        viewport: currentState.viewport,
        canvasSize
      });
      
      try {
        rendererRef.current.render(visibleNodes, currentState.viewport, canvasSize, currentState.interaction.selectedNodes);
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

  // Enhanced hit testing that also checks for resize handles
  const hitTestPoint = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(screenPoint);
    const hits = spatial.hitTest(worldPoint);
    console.log('hitTestPoint:', { 
      screenPoint, 
      worldPoint, 
      viewport: state.viewport,
      hits: hits.length, 
      hitIds: hits.map(n => n.id) 
    });
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
      
      // Debug: Log what we're checking
      console.log('Checking resize handle for selected node:', {
        nodeId: selectedNode.id,
        nodePos: selectedNode.data.position,
        nodeSize: selectedNode.data.size,
        worldPoint,
        viewport: currentState.viewport,
        hasSelectedFlag: nodeWithSelection.visual?.selected
      });
      
      const resizeHandle = MouseInteractions.getResizeHandle(
        worldPoint,
        nodeWithSelection as any, // Type assertion needed for the interface mismatch
        currentState.viewport
      );
      
      if (resizeHandle !== 'none') {
        console.log('✅ Hit resize handle:', resizeHandle);
        return { nodes: [selectedNode], resizeHandle };
      }
    }
    
    // Then check for node hits
    const hits = spatial.hitTest(worldPoint);
    console.log('Regular hit test result:', { 
      hits: hits.length, 
      hitIds: hits.map(n => n.id) 
    });
    return { nodes: hits, resizeHandle: 'none' as ResizeHandle };
  }, [spatial, screenToWorld, stateRef]); // Use stateRef instead of state dependencies

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

  // Enhanced interaction methods
  const startDrag = useCallback((type: 'node' | 'viewport' | 'resize', screenPoint: Point, resizeHandle?: ResizeHandle) => {
    dispatch({ type: 'START_DRAG', dragType: type, startPos: screenPoint, resizeHandle });
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
      dragState: state.interaction.dragState,
      viewport: state.viewport,
      nodes: state.nodes.map(n => ({ id: n.id, pos: n.data.position })),
      selected: state.interaction.selectedNodes.map(n => n.id)
    });
  }, [state.nodes, state.interaction.selectedNodes, state.interaction.dragState, state.viewport]);

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