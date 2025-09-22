import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useDiagram } from './DiagramProvider';
import { MouseInteractions } from '../utils/MouseInteractions';

interface DiagramCanvasProps {
  width: number;
  height: number;
  className?: string;
  showDebugInfo?: boolean;
  onNodeClick?: (node: any) => void;
  onNodeDropped?: (nodeType: any, position: {x: number, y: number}) => void;
  onNodeDoubleClick?: (node: any) => void;
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void;
  selectedNodeType?: any; // For mobile tap-to-place
  onPlaceNode?: (nodeType: any, position: {x: number, y: number}) => void;
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
  onNodeDropped,
  selectedNodeType,
  onPlaceNode,
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

  // Zoom throttling to prevent canvas freeze
  const zoomThrottleRef = useRef<number | null>(null);
  const lastZoomTime = useRef(0);

  const {
    viewport,
    interaction,
    addNode,
    hitTestWithHandles,
    selectNode,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    setViewport,
    screenToWorld,
    getSpatialDebugInfo,
    initializeRenderer,
    isRendererInitialized,
    renderFrame,
  } = useDiagram();

  // Throttled viewport update for mobile zoom
  const throttledSetViewport = useCallback((newViewport: any) => {
    if (zoomThrottleRef.current) {
      clearTimeout(zoomThrottleRef.current);
    }
    
    zoomThrottleRef.current = setTimeout(() => {
      setViewport(newViewport);
      zoomThrottleRef.current = null;
    }, 16); // ~60fps
  }, [setViewport]);

  // Initialize renderer once
  useEffect(() => {
    if (!canvasRef.current || initializationAttempted.current) {
      return;
    }

    const initCanvas = async () => {
      initializationAttempted.current = true;
      console.log('🚀 DiagramCanvas: Initializing renderer...');
      
      try {
        const success = await initializeRenderer(canvasRef.current!);
        
        if (success) {
          console.log('✅ DiagramCanvas: WebGPU initialized');
        } else {
          console.warn('⚠️ DiagramCanvas: WebGPU failed');
        }
      } catch (error) {
        console.error('❌ DiagramCanvas: Init error:', error);
      }
    };

    initCanvas();
  }, [initializeRenderer]);

  // Update viewport size when canvas size changes
  useEffect(() => {
    console.log('Canvas size changed:', { width, height });
    setViewport({ width, height });
  }, [width, height, setViewport]);

  // Trigger render when viewport changes
  useEffect(() => {
    if (isRendererInitialized() && canvasRef.current) {
      renderFrame();
    }
  }, [viewport.x, viewport.y, viewport.zoom, viewport.width, viewport.height, isRendererInitialized, renderFrame]);

  // Update debug info periodically
  useEffect(() => {
    if (showDebugInfo) {
      const interval = setInterval(() => {
        setDebugInfo(getSpatialDebugInfo());
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [showDebugInfo, getSpatialDebugInfo]);

  // Helper functions
  const getCanvasMousePos = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
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
    const worldPos = screenToWorld(canvasPos);
    
    return {
      nodes: result.nodes,
      resizeHandle: result.resizeHandle,
      worldPos
    };
  }, [hitTestWithHandles, screenToWorld]);

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
    console.log('🤏 Touch start:', touches.length, 'touches');

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
      
      if (hitResult.resizeHandle !== 'none') {
        startDrag('resize', canvasPos, hitResult.resizeHandle);
      } else if (hitResult.nodes.length > 0) {
        const topNode = hitResult.nodes[0];
        selectNode(topNode);
        startDrag('node', canvasPos);
        onNodeClick?.(topNode);
      } else {
        clearSelection();
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
      // Single touch drag
      const touch = touches[0];
      const canvasPos = getCanvasTouchPos(touch as Touch);
      
      if (interaction.dragState.isDragging) {
        updateDrag(canvasPos);
      }
      
    } else if (touches.length === 2 && touchState.isPinching) {
      // Pinch zoom - simplified and throttled
      const [touch1, touch2] = touches;
      const currentDistance = getTouchDistance(touch1 as Touch, touch2 as Touch);
      const currentCenter = getTouchCenter(touch1 as Touch, touch2 as Touch);
      
      if (touchState.lastPinchDistance > 0) {
        const now = Date.now();
        if (now - lastZoomTime.current < 50) { // Throttle to 20fps max
          return;
        }
        lastZoomTime.current = now;
        
        // Calculate zoom change
        const zoomFactor = currentDistance / touchState.lastPinchDistance;
        const newZoom = Math.max(0.2, Math.min(3.0, viewport.zoom * zoomFactor));
        
        // Calculate pan - keep it simple
        const centerDeltaX = currentCenter.x - touchState.lastPinchCenter.x;
        const centerDeltaY = currentCenter.y - touchState.lastPinchCenter.y;
        
        // Apply changes with throttling
        throttledSetViewport({
          zoom: newZoom,
          x: viewport.x - centerDeltaX / viewport.zoom,
          y: viewport.y - centerDeltaY / viewport.zoom,
        });
        
        // Update state
        setTouchState(prev => ({
          ...prev,
          lastPinchDistance: currentDistance,
          lastPinchCenter: currentCenter,
        }));
      }
    }
  }, [touchState, getCanvasTouchPos, interaction.dragState.isDragging, 
      updateDrag, viewport, throttledSetViewport]);

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

  // Mouse event handlers (for desktop)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isMobile) return; // Skip on mobile
    
    const canvasPos = getCanvasMousePos(e);
    const hitResult = performHitTest(canvasPos);
    
    let newCursor = 'grab';
    
    if (interaction.dragState.isDragging) {
      if (interaction.dragState.dragType === 'resize') {
        newCursor = MouseInteractions.getCursorForHandle(interaction.dragState.resizeHandle || 'none');
      } else {
        newCursor = 'grabbing';
      }
      updateDrag(canvasPos);
    } else {
      if (hitResult.resizeHandle !== 'none') {
        newCursor = MouseInteractions.getCursorForHandle(hitResult.resizeHandle);
      } else if (hitResult.nodes.length > 0) {
        newCursor = 'grab';
      }
    }
    
    if (newCursor !== currentCursor) {
      setCurrentCursor(newCursor);
    }
  }, [isMobile, getCanvasMousePos, performHitTest, interaction.dragState, updateDrag, currentCursor]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return; // Skip on mobile
    
    const canvasPos = getCanvasMousePos(e);
    const hitResult = performHitTest(canvasPos);

    if (hitResult.resizeHandle !== 'none') {
      startDrag('resize', canvasPos, hitResult.resizeHandle);
    } else if (hitResult.nodes.length > 0) {
      const topNode = hitResult.nodes[0];
      selectNode(topNode);
      startDrag('node', canvasPos);
      onNodeClick?.(topNode);
    } else {
      clearSelection();
      startDrag('viewport', canvasPos);
      onCanvasClick?.(hitResult.worldPos);
    }
  }, [isMobile, getCanvasMousePos, performHitTest, startDrag, selectNode, clearSelection, onNodeClick, onCanvasClick]);

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
    if (isMobile) return; // Skip on mobile
    
    e.preventDefault();
    
    const canvasPos = getCanvasMousePos(e as unknown as React.MouseEvent);
    const worldPosBeforeZoom = screenToWorld(canvasPos);
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom * zoomFactor));
    
    const worldPosAfterZoom = {
      x: (canvasPos.x - viewport.width / 2) / newZoom + viewport.x,
      y: (canvasPos.y - viewport.height / 2) / newZoom + viewport.y,
    };
    
    const deltaX = worldPosAfterZoom.x - worldPosBeforeZoom.x;
    const deltaY = worldPosAfterZoom.y - worldPosBeforeZoom.y;
    
    setViewport({
      zoom: newZoom,
      x: viewport.x + deltaX,
      y: viewport.y + deltaY,
    });
  }, [isMobile, getCanvasMousePos, screenToWorld, viewport, setViewport]);

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

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (isMobile) return;
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    try {
      const nodeTypeData = e.dataTransfer.getData('application/node-type');
      if (!nodeTypeData) return;
      
      const nodeType: any = JSON.parse(nodeTypeData);
      const worldPos = MouseInteractions.dragEventToWorld(e, canvasRef.current, viewport);
      
      const newNodeId = `${nodeType.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newNode = {
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
          selected: false
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
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ 
          cursor: currentCursor,
          touchAction: isMobile ? 'none' : 'auto',
          userSelect: 'none',
          backgroundColor: selectedNodeType ? '#f0f8ff' : 'transparent'
        }}
        // Touch events (mobile)
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchMove={isMobile ? handleTouchMove : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        onTouchCancel={isMobile ? handleTouchCancel : undefined}
        
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