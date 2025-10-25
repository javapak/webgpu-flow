import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useDiagram } from './DiagramProvider';
import { MouseInteractions } from '../utils/MouseInteractions';
import type { DiagramNode } from '../types';

interface DiagramCanvasProps {
  width: number;
  height: number;
  internalResolutionRef: React.RefObject<{width: number, height: number}>;
  className?: string;
  showDebugInfo?: boolean;
  onNodeClick?: (node: any) => void;
  onNodeDropped?: (nodeType: any, position: {x: number, y: number}) => void;
  onNodeDoubleClick?: (node: any) => void;
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void;
  selectedNodeType?: any; // For mobile tap-to-place
  onPlaceNode?: (nodeType: any, position: {x: number, y: number}) => void;
  setSupportedSampleCount: React.Dispatch<React.SetStateAction<string[] | undefined>>
}

// Mobile detection utility
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
};

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  width,
  height,
  className = '',
  showDebugInfo = false,
  onNodeClick,
  onCanvasClick,
  internalResolutionRef,
  onNodeDropped,
  selectedNodeType,
  onPlaceNode,
  setSupportedSampleCount
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [currentCursor, setCurrentCursor] = useState<string>('grab');
  const initializationAttempted = useRef(false);

  const isMobile = isMobileDevice();

  
  // Mobile touch state - simplified and more stable
  const [touchState, setTouchState] = useState<{
    touches: Map<number, any>;
    isPinching: boolean;
    lastPinchDistance: number;
    lastPinchCenter: { x: number; y: number };
  }>({
    touches: new Map(),
    isPinching: false,
    lastPinchDistance: 0,
    lastPinchCenter: { x: 0, y: 0 },
  });


  const zoomRequestRef = useRef<number | null>(null);

  const {
    viewport,
    interaction,
    addNode,
    
    hitTestWithHandles,
    selectNode,
    selectEdge,
    clearEdgeSelection,
    clearSelection,
    startDrag,
    updateDrag,
    startDrawing,
    drawingState,
    exitDrawMode,
    completeEdge,
    hitTestEdge,
    addControlPoint,
    endDrag,
    setViewport,
    screenToWorld,
    getRenderer,
    getSpatialDebugInfo,
    initializeRenderer,
    isRendererInitialized,
    renderFrame,
    addEdge,
    mode
  } = useDiagram();


useEffect(() => {
  return () => {
    if (zoomRequestRef.current) {
      cancelAnimationFrame(zoomRequestRef.current);
    }
  };
}, []);


  useEffect(() => {
    if (!canvasRef.current || initializationAttempted.current) {
      return;
    }

    const initCanvas = async () => {
      initializationAttempted.current = true;
      
      try {
        const success = await initializeRenderer(canvasRef.current!);
        
        if (success) {
          console.log('DiagramCanvas: WebGPU initialized');
          setSupportedSampleCount(getRenderer()?.sampleCountsSupported);
        } else {
          console.warn('DiagramCanvas: WebGPU failed');
        }
      } catch (error) {
        console.error('DiagramCanvas: Init error:', error);
      }
    };

    initCanvas();
  }, [initializeRenderer, getRenderer, setSupportedSampleCount]);



useEffect(() => {
  const updateOnSizeChange = async () => {
    // Check if renderer is busy before attempting resize
    if (!getRenderer() || getRenderer()?.isBusy) {
      console.log('Skipping size change, renderer busy');
      return;
    }
    
    try {
      setViewport({ width, height });
      console.log('Updated depth texture on size change');


    } catch (error) {
      console.error('Failed to update depth texture on size change:', error);
    }
  };
  
  updateOnSizeChange();
}, [width, height, setViewport, getRenderer]);

useEffect(() => {
  // Only render if initialized and not busy with resize/reconfiguration
  if (isRendererInitialized() && !getRenderer()?.isBusy && canvasRef.current) {
    // check if depth texture exists and matches canvas size
    const renderer = getRenderer();
    if (renderer && renderer.depthTexture) {
      requestAnimationFrame(() => {
        // Double-check busy state before rendering
        if (!renderer.isBusy) {
          renderFrame();
        }
      });
    }
  }
}, [viewport.x, viewport.y, drawingState.isDrawing, drawingState.userVertices, 
    viewport.zoom, viewport.width, viewport.height, isRendererInitialized, 
    getRenderer, renderFrame]);

  // Update debug info periodically
  useEffect(() => {
    if (showDebugInfo) {
      const interval = setInterval(() => {
        setDebugInfo(getSpatialDebugInfo());
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [showDebugInfo, getSpatialDebugInfo]);
  
  const getCanvasMousePos = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !canvasRef.current) return { x: 0, y: 0 };
  
    const visualX = e.clientX - rect.left;
    const visualY = e.clientY - rect.top;
    
    // ADD SCALE FACTOR:
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    
    return {
      x: visualX * scaleX,
      y: visualY * scaleY,
    };
}, []);


  const getCanvasTouchPos = useCallback((touch: Touch) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }, []);

  const performHitTest = useCallback((canvasPos: { x: number; y: number }) => {
    const result = hitTestWithHandles(canvasPos);
    const edgeResults = hitTestEdge(canvasPos);
    const worldPos = screenToWorld(canvasPos);
    
    return {
      nodes: result.nodes,
      selectedEdge: edgeResults.edge || null,
      edgeVertexIndex: edgeResults.vertexIndex,
      isEdgeVertex: edgeResults.isVertex,
      resizeHandle: result.resizeHandle,
      worldPos
    };
  }, [hitTestWithHandles, hitTestEdge, screenToWorld]);

  const getTouchDistance = (touch1: Touch, touch2: Touch): number => {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touch1: Touch, touch2: Touch) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    return {
      x: (touch1.clientX + touch2.clientX) / 2 - rect.left,
      y: (touch1.clientY + touch2.clientY) / 2 - rect.top,
    };
  };

  // Mobile touch handlers - fixed and simplified
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const touches = Array.from(e.touches);

    if (touches.length === 1) {
      // Single touch
      const touch = touches[0];
      const canvasPos = getCanvasTouchPos(touch as Touch);
      
      setTouchState(prev => ({
        ...prev,
        touches: new Map([[touch.identifier, {
          startX: canvasPos.x,
          startY: canvasPos.y,
          currentX: canvasPos.x,
          currentY: canvasPos.y,
          startTime: Date.now(),
        }]]),
        isPinching: false,
      }));

      // Handle mobile tap-to-place mode
      if (selectedNodeType && onPlaceNode) {
        const worldPos = screenToWorld(canvasPos);
        onPlaceNode(selectedNodeType, worldPos);
        if (navigator.vibrate) navigator.vibrate(100);
        return;
      }

      // Regular node/canvas interaction
      const hitResult = performHitTest(canvasPos);
      if (hitResult.selectedEdge) {
        console.log('Edge selected')
        clearEdgeSelection();
        clearSelection();
        selectEdge(hitResult.selectedEdge);

      }
      
      else if (hitResult.resizeHandle !== 'none') {
        startDrag('resize', canvasPos, hitResult.resizeHandle);
      } else if (hitResult.nodes.length > 0) {
        const topNode = hitResult.nodes[0];
        selectNode(topNode);
        startDrag('node', canvasPos);
        onNodeClick?.(topNode);
      } else {
        clearSelection();
        clearEdgeSelection();
        startDrag('viewport', canvasPos);
        onCanvasClick?.(hitResult.worldPos);
      }
      
    } else if (touches.length === 2) {
      // Two touches - pinch zoom
      const [touch1, touch2] = touches;
      const distance = getTouchDistance(touch1 as Touch, touch2 as Touch);
      const center = getTouchCenter(touch1 as Touch, touch2 as Touch);

      // End any existing drag
      if (interaction.dragState.isDragging) {
        endDrag();
      }

      setTouchState(prev => ({
        ...prev,
        isPinching: true,
        lastPinchDistance: distance,
        lastPinchCenter: center,
      }));
    }
  }, [getCanvasTouchPos, selectedNodeType, onPlaceNode, performHitTest, 
      startDrag, selectNode, clearSelection, onNodeClick, onCanvasClick, 
      screenToWorld, interaction.dragState.isDragging, endDrag]);


  const handleTouchMove = useCallback((e: React.TouchEvent) => {
  e.preventDefault();
  
  const touches = Array.from(e.touches);
  
  if (touches.length === 1 && !touchState.isPinching) {
    // Single touch drag - unchanged
    const touch = touches[0];
    const canvasPos = getCanvasTouchPos(touch as Touch);
    
    if (interaction.dragState.isDragging) {
      updateDrag(canvasPos);
    }
    
  } else if (touches.length === 2 && touchState.isPinching) {
    // Ultra-optimized pinch zoom
    const [touch1, touch2] = touches;
    
    // Pre-calculate squared distances to avoid sqrt until needed
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    const currentDistanceSquared = dx * dx + dy * dy;
    
    // Only update if distance changed significantly (reduces unnecessary updates)
    const lastDistanceSquared = touchState.lastPinchDistance * touchState.lastPinchDistance;
    const distanceChangeRatio = Math.abs(currentDistanceSquared - lastDistanceSquared) / Math.max(lastDistanceSquared, 1);
    
    if (distanceChangeRatio > 0.001) { // Only update if 0.1% change
      const currentDistance = Math.sqrt(currentDistanceSquared);
      
      if (touchState.lastPinchDistance > 0) {
        // Simple zoom factor
        const zoomFactor = currentDistance / touchState.lastPinchDistance;
        
        // Clamp zoom without complex math
        let newZoom = viewport.zoom * zoomFactor;
        if (newZoom < 0.2) newZoom = 0.2;
        if (newZoom > 3.0) newZoom = 3.0;
        
        // Skip center calculation entirely - just zoom at current viewport center
        // This eliminates the most expensive calculation
        setViewport({
          zoom: newZoom,
          x: viewport.x, // Keep current position
          y: viewport.y,
        });
        
        // Minimal state update
        touchState.lastPinchDistance = currentDistance;
      }
    }
  }
}, [touchState, getCanvasTouchPos, interaction.dragState.isDragging, 
    updateDrag, viewport.zoom, setViewport]);


  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const remainingTouches = Array.from(e.touches);
    
    if (remainingTouches.length === 0) {
      // All touches ended
      if (interaction.dragState.isDragging) {
        endDrag();
      }
      
      setTouchState({
        touches: new Map(),
        isPinching: false,
        lastPinchDistance: 0,
        lastPinchCenter: { x: 0, y: 0 },
      });
    } else if (remainingTouches.length === 1 && touchState.isPinching) {
      // Transition from pinch to single touch
      setTouchState(prev => ({
        ...prev,
        isPinching: false,
        lastPinchDistance: 0,
      }));
    }
  }, [interaction.dragState.isDragging, endDrag, touchState.isPinching]);

  const handleTouchCancel = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    if (interaction.dragState.isDragging) {
      endDrag();
    }
    
    setTouchState({
      touches: new Map(),
      isPinching: false,
      lastPinchDistance: 0,
      lastPinchCenter: { x: 0, y: 0 },
    });
  }, [interaction.dragState.isDragging, endDrag]);


  useEffect(() => {
    if (isMobile && canvasRef.current){
      canvasRef.current.addEventListener('touchstart', 
        handleTouchStart as unknown as (e: TouchEvent) => void, {passive: false});
    }
    return () =>  canvasRef.current!.removeEventListener('touchstart', handleTouchStart as unknown as (e: TouchEvent) => void);
  }, [handleTouchStart]);

  useEffect(() => {
    if (isMobile && canvasRef.current){
      canvasRef.current.addEventListener('touchmove', 
        handleTouchMove as unknown as (e: TouchEvent) => void, {passive: false});
    }
    return () =>  canvasRef.current!.removeEventListener('touchmove', handleTouchMove as unknown as (e: TouchEvent) => void);
  }, [handleTouchMove]);


  useEffect(() => {
    if (isMobile && canvasRef.current){
      canvasRef.current.addEventListener('touchend', 
        handleTouchEnd as unknown as (e: TouchEvent) => void, {passive: false});
    }
    return () =>  canvasRef.current!.removeEventListener('touchend', handleTouchEnd as unknown as (e: TouchEvent) => void);
  }, [handleTouchEnd]);

  useEffect(() => {
    if (isMobile && canvasRef.current){
      canvasRef.current.addEventListener('touchcancel', 
        handleTouchCancel as unknown as (e: TouchEvent) => void, {passive: false});
    }
    return () =>  canvasRef.current!.removeEventListener('touchcancel', handleTouchCancel as unknown as (e: TouchEvent) => void);
  }, [handleTouchCancel]);

  


  useEffect(() => {
    if (mode === 'draw_edge')
      setCurrentCursor('crosshair');
    else 
      setCurrentCursor('grabbing');
  }, [mode]);

const handleMouseMove = useCallback((e: React.MouseEvent) => {
  if (isMobile) return;
  
  const canvasPos = getCanvasMousePos(e);
  const hitResult = performHitTest(canvasPos);
  const worldPos = screenToWorld(canvasPos);

  

  if (mode === 'draw_edge' && drawingState.isDrawing) {
    // Always keep one vertex as the preview vert that follows the cursor
    if (drawingState.userVertices.length === 0) {
      // First vertex added as preview
      addControlPoint(worldPos, false);
    } else {
      // Update the last vertex to follow cursor
      addControlPoint(worldPos, true);
    }
    return;
  }
  
  let newCursor = 'grab';
  
  if (interaction.dragState.isDragging) {
    if (interaction.dragState.dragType === 'resize') {
      newCursor = MouseInteractions.getCursorForHandle(interaction.dragState.resizeHandle || 'none');
    } else if (interaction.dragState.dragType === 'edge-vertex' || interaction.dragState.dragType === 'node') {
      newCursor = 'move'; 
    }
     else {
      newCursor = 'grabbing';
    }
    updateDrag(canvasPos);


  } else {
    if (hitResult.resizeHandle !== 'none') {
      newCursor = MouseInteractions.getCursorForHandle(hitResult.resizeHandle);
    } else if (hitResult.nodes.length > 0 || hitResult.selectedEdge) {
      newCursor = 'pointer';
    }

  }
  
  if (newCursor !== currentCursor && mode !== 'draw_edge') {
    setCurrentCursor(newCursor);
  }

}, [isMobile, drawingState.userVertices, drawingState.isDrawing, getCanvasMousePos, performHitTest, interaction.dragState, 
    updateDrag, screenToWorld, mode, currentCursor, addControlPoint]);

const handleMouseDown = useCallback((e: React.MouseEvent) => {
  if (isMobile) return;
  
  const canvasPos = getCanvasMousePos(e);
  const worldPos = screenToWorld(canvasPos);
  const hitResult = performHitTest(canvasPos);

  if (mode === 'draw_edge') {
    
    if (hitResult.nodes.length > 0 && !drawingState.isDrawing) {
      console.log('drawing started....');
      startDrawing(hitResult.nodes[0].id);
      
   }

    else if (drawingState.isDrawing && hitResult.nodes.length === 0) {
        console.log('adding control point at: ', worldPos);
        addControlPoint(worldPos);;
    } 

    else if (drawingState.isDrawing && hitResult.nodes.length > 0) {
      if (hitResult.nodes[0].id !== drawingState.sourceNodeId) {

        addEdge(completeEdge(hitResult.nodes[0].id)!);
        exitDrawMode();
    
      }
    }
  }



  if (!drawingState.isDrawing && mode !== 'draw_edge') {
    // First check for resize handles on selected nodes

    if (interaction.selectedEdges.length > 0 && hitResult.selectedEdge?.id && hitResult.isEdgeVertex) {
      // Start dragging edge vertex
      console.log('======Starting edge vertex drag======');
      console.log('edge-vertex', canvasPos, hitResult.selectedEdge.id, hitResult.edgeVertexIndex);
      
      startDrag('edge-vertex', canvasPos, undefined, hitResult.selectedEdge.id, hitResult.edgeVertexIndex);
      return;
    }

    if (hitResult.selectedEdge) {
      // Select edge, but do not block viewport drag if clicking on empty canvas
      clearSelection();
      selectEdge(hitResult.selectedEdge);
      // If not clicking on an edge vertex or handle, allow viewport drag
      if (!hitResult.isEdgeVertex && hitResult.nodes.length === 0 && hitResult.resizeHandle === 'none') {
        startDrag('viewport', canvasPos);
        onCanvasClick?.(hitResult.worldPos);
      }
    }
    else if (hitResult.resizeHandle !== 'none') {
      startDrag('resize', canvasPos, hitResult.resizeHandle);
    } 
    // Then check for node selection
    else if (hitResult.nodes.length > 0) {
      const topNode = hitResult.nodes[0];
      clearEdgeSelection();
      clearSelection();
      selectNode(topNode);
      startDrag('node', canvasPos);
      onNodeClick?.(topNode);
    } 
    else {
      clearSelection();
      clearEdgeSelection();
      startDrag('viewport', canvasPos);
      onCanvasClick?.(hitResult.worldPos);
    }
  }
}, [isMobile, getCanvasMousePos, drawingState, startDrawing, addControlPoint, mode, performHitTest, 
    startDrag, selectNode, clearSelection, screenToWorld, onNodeClick, onCanvasClick, 
    interaction. selectedEdges, selectEdge]);

  const handleMouseUp = useCallback(() => {
    if (isMobile) return; // Skip on mobile

    
    if (interaction.dragState.isDragging) {
      endDrag();
    }
  }, [isMobile, interaction.dragState.isDragging, endDrag]);


  const handleMouseLeave = useCallback(() => {
    if (isMobile) return; // Skip on mobile
    
    if (interaction.dragState.isDragging) {
      endDrag();
    }
  }, [isMobile, interaction.dragState.isDragging, endDrag]);

  // Wheel zoom (desktop only)
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isMobile) return;
    
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // Convert screen to canvas coordinates
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const canvasX = screenX * scaleX;
    const canvasY = screenY * scaleY;
    
    // Get world position at mouse before zoom
    const worldBeforeZoom = screenToWorld({ x: screenX, y: screenY });
    
    // Calculate new zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom * zoomFactor));
    
    // Calculate new viewport position to keep mouse point stationary
    // Formula: worldPos = (canvasPos - canvasCenter) / zoom + viewportPos
    // Solving for viewportPos: viewportPos = worldPos - (canvasPos - canvasCenter) / zoom
    const canvasCenterX = canvasRef.current.width / 2;
    const canvasCenterY = canvasRef.current.height / 2;
    
    const newViewportX = worldBeforeZoom.x - (canvasX - canvasCenterX) / newZoom;
    const newViewportY = worldBeforeZoom.y - (canvasY - canvasCenterY) / newZoom;
    
    setViewport({
      zoom: newZoom,
      x: newViewportX,
      y: newViewportY,
    });
  }, [isMobile, screenToWorld, canvasRef, viewport.zoom, setViewport]);

  useEffect(() => {
    if (canvasRef.current && !isMobile) {
      canvasRef.current.addEventListener('wheel', handleWheel, {passive: false});
      return () => {
        if (canvasRef.current) {
          canvasRef.current.removeEventListener('wheel', handleWheel);
        }
      };
    }
  }, [handleWheel, isMobile]);

  // Drag and drop handlers (desktop only)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isMobile) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [isMobile]);

  useEffect(() => {
    console.log('Edge completed');
  }, [completeEdge]);

  const dragEventToWorld = (e: React.DragEvent, canvas: HTMLCanvasElement, viewport: any) => {
    console.log(viewport);
    const rect = canvas.getBoundingClientRect();
    const top = rect.top;
    const left = rect.left;
    return screenToWorld({
      x: e.clientX - left,
      y: e.clientY - top
    });
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (isMobile) return;
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    try {
      const nodeTypeData = e.dataTransfer.getData('application/node-type');
      if (!nodeTypeData) return;
      
      const nodeType: any = JSON.parse(nodeTypeData);
      const worldPos = dragEventToWorld(e, canvasRef.current, viewport);
      
      const newNodeId = `${nodeType.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newNode: DiagramNode = {
        id: newNodeId,
        type: nodeType.id,
        data: { 
          label: nodeType.name,
          position: worldPos,
          size: { width: nodeType.width, height: nodeType.height }
        },
        visual: {
          color: nodeType.color,
          shape: nodeType.shape,
          selected: false,
          size: { width: nodeType.width, height: nodeType.height }

        }
      };
      
      addNode(newNode);
      onNodeDropped?.(nodeType, worldPos);
      
    } catch (error) {
      console.error('Drop error:', error);
    }
  }, [isMobile, viewport, addNode, onNodeDropped]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (isMobile) return;
    e.preventDefault();
    if (canvasRef.current) {
      canvasRef.current.style.backgroundColor = '#f0f8ff';
    }
  }, [isMobile]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (isMobile) return;
    if (canvasRef.current && !canvasRef.current.contains(e.relatedTarget as Node)) {
      canvasRef.current.style.backgroundColor = '';
    }
  }, [isMobile]);

  // Helper function for debug display
  const getMaxDepth = (nodeInfo: any): number => {
    if (!nodeInfo || !nodeInfo.children) return nodeInfo?.depth || 0;
    return Math.max(nodeInfo.depth, ...nodeInfo.children.map((child: any) => getMaxDepth(child)));
  };

  return (
    <>
    <div style={{ overflow: 'hidden', width: `${width}px`, height: `${height}px` }} >
      <canvas
        ref={canvasRef}
        width={internalResolutionRef.current.width}
        height={internalResolutionRef.current.height}
        style={{ 
          width: `${width}px`,
          height: `${height}px`,
          cursor: currentCursor,
          transform: `scale(${internalResolutionRef.current.width / width}, ${internalResolutionRef.current.height / height})`,

          touchAction: isMobile ? 'none' : 'auto',
          userSelect: 'none',
          backgroundColor: selectedNodeType ? '#f0f8ff' : 'transparent'
        }}

        // Mouse events (desktop)
        onPointerDown={!isMobile ? handleMouseDown : undefined}
        onPointerMove={!isMobile ? handleMouseMove : undefined}
        onPointerUp={!isMobile ? handleMouseUp : undefined}
        onPointerLeave={!isMobile ? handleMouseLeave : undefined}
        
        // Drag and drop (desktop only)
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      
      {/* Mobile placement indicator */}
      {isMobile && selectedNodeType && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#0066cc',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '20px',
          fontSize: '12px',
          zIndex: 1000,
          pointerEvents: 'none'
        }}>
          Tap canvas to place {selectedNodeType.name}
        </div>
      )}
      
      <div className={`relative ${className}`}>
        {showDebugInfo && (
          <div>
            <div>
              Initialized: {isRendererInitialized() ? 'Yes' : 'No'}, 
              Zoom: {viewport.zoom.toFixed(2)}x, 
              Position: ({viewport.x.toFixed(0)}, {viewport.y.toFixed(0)}), 
              Canvas Size: {viewport.width}x{viewport.height}
              <div>
                Selected: {interaction.selectedNodes.length}, 
                Dragging: {interaction.dragState.isDragging ? interaction.dragState.dragType : 'No'}
                {touchState.touches.size > 0 && (
                  <span>, Touches: {touchState.touches.size}{touchState.isPinching && ' (Pinching)'}</span>
                )}
                {debugInfo && (
                  <span>, Spatial Items: {debugInfo.totalItems}, Max Depth: {getMaxDepth(debugInfo.quadTreeInfo)}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      
    </div>
    </>
  );
};


// Performance monitoring component (unchanged)
interface PerformanceMonitorProps {
  className?: string;
}

export const DiagramPerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  className = '',
}) => {
  const { getSpatialDebugInfo } = useDiagram();
  const [stats, setStats] = useState<any>(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(getSpatialDebugInfo());
    }, 1000);
    
    return () => clearInterval(interval);
  }, [getSpatialDebugInfo]);

  const getMaxDepth = (nodeInfo: any): number => {
    if (!nodeInfo || !nodeInfo.children) return nodeInfo?.depth || 0;
    
    return Math.max(
      nodeInfo.depth,
      ...nodeInfo.children.map((child: any) => getMaxDepth(child))
    );
  };
  
  return (
    <div className={`bg-gray-100 p-4 rounded ${className}`}>
      <h3 className="text-lg font-semibold mb-2">Spatial Index Performance</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="font-medium">Total Nodes:</span> {stats?.totalItems || 0}
        </div>
        <div>
          <span className="font-medium">Max Depth:</span> {stats ? getMaxDepth(stats.quadTreeInfo) : 0}
        </div>
      </div>
      
    </div>
  );
};