import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useDiagram } from './DiagramProvider';
import { MouseInteractions } from '../utils/MouseInteractions';
import { MobileUtils } from '../utils/MobileUtils';

interface DiagramCanvasProps {
  width: number;
  height: number;
  className?: string;
  showDebugInfo?: boolean;
  onNodeClick?: (node: any) => void;
  onNodeDropped?: (nodeType: any, position: {x: number, y: number}) => void;
  onNodeDoubleClick?: (node: any) => void;
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void;
}

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  width,
  height,
  className = '',
  showDebugInfo = false,
  onNodeClick,
  onCanvasClick,
  onNodeDropped,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [currentCursor, setCurrentCursor] = useState<string>('grab');
  const initializationAttempted = useRef(false);
  
  // Mobile touch state
  const [touchState, setTouchState] = useState<{
    touches: Map<number, any>;
    isPinching: boolean;
    initialDistance: number;
    initialZoom: number;
    initialCenterX: number;
    initialCenterY: number;
  }>({
    touches: new Map(),
    isPinching: false,
    initialDistance: 0,
    initialZoom: 1,
    initialCenterX: 0,
    initialCenterY: 0,
  });

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


    // Enhanced hit testing that checks for resize handles
  const performHitTest = useCallback((canvasPos: { x: number; y: number }) => {
    const result = hitTestWithHandles(canvasPos);
    
    // Add world position for compatibility
    const worldPos = screenToWorld(canvasPos);
    
    console.log('Canvas hit test result:', {
      canvasPos,
      worldPos,
      nodes: result.nodes.length,
      resizeHandle: result.resizeHandle,
      selectedNodes: interaction.selectedNodes.length
    });
    
    return {
      nodes: result.nodes,
      resizeHandle: result.resizeHandle,
      worldPos
    };
  }, [hitTestWithHandles, screenToWorld, interaction.selectedNodes]);

  // Helper functions
  const getCanvasTouchPos = useCallback((touch: Touch) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }, []);

  const getTouchDistance = (touch1: Touch, touch2: Touch): number => {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touch1: Touch, touch2: Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  };

  // Mobile touch event handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const touches = Array.from(e.touches);
    console.log('🤏 Touch start:', touches.length, 'touches');

    if (touches.length === 1) {
      // Single touch - potential tap or drag
      const touch = touches[0];
      const canvasPos = getCanvasTouchPos(touch as Touch);
      const hitResult = performHitTest(canvasPos);
      
      const newTouchState = {
        active: true,
        identifier: touch.identifier,
        startX: canvasPos.x,
        startY: canvasPos.y,
        currentX: canvasPos.x,
        currentY: canvasPos.y,
        startTime: Date.now(),
      };

      setTouchState(prev => ({
        ...prev,
        touches: new Map([[touch.identifier, newTouchState]]),
        isPinching: false,
      }));

      // Handle node/canvas interaction
      if (hitResult.resizeHandle !== 'none') {
        console.log('🔄 Touch resize start:', hitResult.resizeHandle);
        startDrag('resize', canvasPos, hitResult.resizeHandle);
      } else if (hitResult.nodes.length > 0) {
        const topNode = hitResult.nodes[0];
        console.log('🎯 Touch node:', topNode.id);
        selectNode(topNode);
        startDrag('node', canvasPos);
        onNodeClick?.(topNode);
      } else {
        console.log('🌍 Touch canvas');
        clearSelection();
        startDrag('viewport', canvasPos);
        onCanvasClick?.(hitResult.worldPos);
      }
      
    } else if (touches.length === 2) {
      // Two touches - pinch to zoom
      const [touch1, touch2] = touches;
      const distance = getTouchDistance(touch1 as Touch, touch2 as Touch);
      const center = getTouchCenter(touch1 as Touch, touch2 as Touch);
      const canvasCenter = {
        x: center.x - (canvasRef.current?.getBoundingClientRect().left || 0),
        y: center.y - (canvasRef.current?.getBoundingClientRect().top || 0),
      };

      console.log('🤏 Pinch start:', { distance, center: canvasCenter });

      // End any existing drag operation
      if (interaction.dragState.isDragging) {
        endDrag();
      }

      setTouchState(prev => ({
        ...prev,
        touches: new Map([
          [touch1.identifier, {
            active: true,
            identifier: touch1.identifier,
            startX: touch1.clientX,
            startY: touch1.clientY,
            currentX: touch1.clientX,
            currentY: touch1.clientY,
            startTime: Date.now(),
          }],
          [touch2.identifier, {
            active: true,
            identifier: touch2.identifier,
            startX: touch2.clientX,
            startY: touch2.clientY,
            currentX: touch2.clientX,
            currentY: touch2.clientY,
            startTime: Date.now(),
          }],
        ]),
        isPinching: true,
        initialDistance: distance,
        initialZoom: viewport.zoom,
        initialCenterX: viewport.x,
        initialCenterY: viewport.y,
      }));
    }
  }, [getCanvasTouchPos, performHitTest, startDrag, selectNode, clearSelection, 
      onNodeClick, onCanvasClick, viewport, interaction.dragState, endDrag]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const touches = Array.from(e.touches);
    
    if (touches.length === 1 && !touchState.isPinching) {
      // Single touch drag
      const touch = touches[0];
      const canvasPos = getCanvasTouchPos(touch as Touch);
      const touchInfo = touchState.touches.get(touch.identifier);
      
      if (touchInfo && interaction.dragState.isDragging) {
        console.log('📱 Touch drag update');
        updateDrag(canvasPos);
        
        setTouchState(prev => ({
          ...prev,
          touches: new Map(prev.touches.set(touch.identifier, {
            ...touchInfo,
            currentX: canvasPos.x,
            currentY: canvasPos.y,
          })),
        }));
      }
      
    } else if (touches.length === 2 && touchState.isPinching) {
      // Two-touch pinch/pan
      const [touch1, touch2] = touches;
      const currentDistance = getTouchDistance(touch1 as Touch, touch2 as Touch);
      const currentCenter = getTouchCenter(touch1 as Touch, touch2 as Touch);
      const canvasCenter = {
        x: currentCenter.x - (canvasRef.current?.getBoundingClientRect().left || 0),
        y: currentCenter.y - (canvasRef.current?.getBoundingClientRect().top || 0),
      };

      if (touchState.initialDistance > 0) {
        // Calculate zoom
        const zoomFactor = currentDistance / touchState.initialDistance;
        const constraints = MobileUtils.getMobileZoomConstraints();
        const newZoom = Math.max(constraints.min, Math.min(constraints.max, touchState.initialZoom * zoomFactor));
        
        // Calculate pan offset
        const worldCenter = screenToWorld(canvasCenter);
        
        console.log('🤏 Pinch update:', { 
          zoomFactor: zoomFactor.toFixed(3),
          newZoom: newZoom.toFixed(3),
          center: canvasCenter 
        });

        setViewport({
          zoom: newZoom,
          x: worldCenter.x,
          y: worldCenter.y,
        });
      }
    }
  }, [touchState, getCanvasTouchPos, interaction.dragState, updateDrag, 
      screenToWorld, setViewport]);


  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const remainingTouches = Array.from(e.touches);
    const endedTouches = Array.from(e.changedTouches);
    
    console.log('🤏 Touch end:', {
      ended: endedTouches.length,
      remaining: remainingTouches.length,
      wasPinching: touchState.isPinching
    });

    // Handle tap gesture detection
    if (endedTouches.length === 1 && remainingTouches.length === 0) {
      const touch = endedTouches[0];
      const touchInfo = touchState.touches.get(touch.identifier);
      
      if (touchInfo) {
        const duration = Date.now() - touchInfo.startTime;
        const distance = MobileUtils.distance(
          { x: touchInfo.currentX, y: touchInfo.currentY },
          { x: touchInfo.startX, y: touchInfo.startY }
        );
        
        const isTap = MobileUtils.isTap(
          { x: touchInfo.startX, y: touchInfo.startY },
          { x: touchInfo.currentX, y: touchInfo.currentY },
          duration
        );
        
        console.log('👆 Potential tap:', { duration, distance, isTap });
        
        if (isTap) {
          // Provide haptic feedback for mobile taps
          MobileUtils.vibrate(50);
        }
      }
    }

    // End drag if no touches remain
    if (remainingTouches.length === 0) {
      if (interaction.dragState.isDragging) {
        console.log('Ending drag - no touches');
        endDrag();
      }
      
      setTouchState({
        touches: new Map(),
        isPinching: false,
        initialDistance: 0,
        initialZoom: 1,
        initialCenterX: 0,
        initialCenterY: 0,
      });
    } else if (remainingTouches.length === 1 && touchState.isPinching) {
      // Transition from pinch to single touch
      const remainingTouch = remainingTouches[0];
      const canvasPos = getCanvasTouchPos(remainingTouch as Touch);
      
      setTouchState(prev => ({
        ...prev,
        touches: new Map([[remainingTouch.identifier, {
          active: true,
          identifier: remainingTouch.identifier,
          startX: canvasPos.x,
          startY: canvasPos.y,
          currentX: canvasPos.x,
          currentY: canvasPos.y,
          startTime: Date.now(),
        }]]),
        isPinching: false,
      }));
      
      // Start new single-touch interaction
      const hitResult = performHitTest(canvasPos);
      if (hitResult.nodes.length > 0) {
        const topNode = hitResult.nodes[0];
        selectNode(topNode);
        startDrag('node', canvasPos);
      } else {
        startDrag('viewport', canvasPos);
      }
    }
  }, [touchState, getCanvasTouchPos, interaction.dragState, endDrag, 
      performHitTest, selectNode, startDrag]);

  const handleTouchCancel = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    console.log('🤏 Touch cancelled');
    
    if (interaction.dragState.isDragging) {
      endDrag();
    }
    
    setTouchState({
      touches: new Map(),
      isPinching: false,
      initialDistance: 0,
      initialZoom: 1,
      initialCenterX: 0,
      initialCenterY: 0,
    });
  }, [interaction.dragState, endDrag]);

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
    console.log('📐 Canvas size changed:', { width, height });
    setViewport({ width, height });
  }, [width, height, setViewport]);

  // Trigger render when viewport changes
  useEffect(() => {
    if (isRendererInitialized() && canvasRef.current) {
      console.log('🔄 VIEWPORT CHANGED, triggering render:', {
        x: viewport.x,
        y: viewport.y, 
        zoom: viewport.zoom,
        width: viewport.width,
        height: viewport.height
      });
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

  // Mouse position helper - returns canvas coordinates
  const getCanvasMousePos = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);



  // Mouse move handler for cursor updates
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvasPos = getCanvasMousePos(e);
    const hitResult = performHitTest(canvasPos);
    
    // Update cursor based on what we're hovering over
    let newCursor = 'grab';
    
    if (interaction.dragState.isDragging) {
      if (interaction.dragState.dragType === 'resize') {
        newCursor = MouseInteractions.getCursorForHandle(interaction.dragState.resizeHandle || 'none');
      } else if (interaction.dragState.dragType === 'node') {
        newCursor = 'grabbing';
      } else {
        newCursor = 'grabbing';
      }
      updateDrag(canvasPos);
    } else {
      if (hitResult.resizeHandle !== 'none') {
        newCursor = MouseInteractions.getCursorForHandle(hitResult.resizeHandle);
      } else if (hitResult.nodes.length > 0) {
        newCursor = 'grab';
      } else {
        newCursor = 'grab';
      }
    }
    
    if (newCursor !== currentCursor) {
      setCurrentCursor(newCursor);
    }
  }, [getCanvasMousePos, performHitTest, interaction.dragState, updateDrag, currentCursor]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    console.log('🖱️ Mouse down');
    const canvasPos = getCanvasMousePos(e);
    const hitResult = performHitTest(canvasPos);
    
    console.log('Mouse down:', { canvasPos, hitResult, viewport });

    if (hitResult.resizeHandle !== 'none') {
      // Start resize operation
      console.log('🔄 Starting resize:', hitResult.resizeHandle);
      startDrag('resize', canvasPos, hitResult.resizeHandle);
    } else if (hitResult.nodes.length > 0) {
      const topNode = hitResult.nodes[0];
      console.log('🎯 Node hit:', topNode.id);
      selectNode(topNode);
      startDrag('node', canvasPos);
      onNodeClick?.(topNode);
    } else {
      console.log('🌍 Canvas hit');
      clearSelection();
      startDrag('viewport', canvasPos);
      onCanvasClick?.(hitResult.worldPos);
    }
  }, [getCanvasMousePos, performHitTest, startDrag, selectNode, clearSelection, onNodeClick, onCanvasClick, viewport]);

  const handleMouseUp = useCallback(() => {
    if (interaction.dragState.isDragging) {
      console.log('🖱️ Mouse up, ending drag:', interaction.dragState.dragType);
      endDrag();
    }
  }, [interaction.dragState.isDragging, endDrag]);

  const handleMouseLeave = useCallback(() => {
    if (interaction.dragState.isDragging) {
      console.log('🖱️ Mouse leave, ending drag');
      endDrag();
    }
  }, [interaction.dragState.isDragging, endDrag]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    const canvasPos = getCanvasMousePos(e as unknown as React.MouseEvent);
    const worldPosBeforeZoom = screenToWorld(canvasPos);
    
    // Calculate zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom * zoomFactor));
    
    // Calculate new viewport position to keep mouse point fixed
    // Use current viewport dimensions for accurate calculation
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
  }, [getCanvasMousePos, screenToWorld, viewport, setViewport]);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.addEventListener('wheel', handleWheel, {passive: false})
    
      return () => {
        if (canvasRef.current)
        canvasRef.current.removeEventListener('wheel', handleWheel);
      }
    }
  }, [handleWheel]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    try {
      const nodeTypeData = e.dataTransfer.getData('application/node-type');
      if (!nodeTypeData) return;
      
      const nodeType: any = JSON.parse(nodeTypeData);
      
      // Use the fixed coordinate transformation
      const worldPos = MouseInteractions.dragEventToWorld(
        e,
        canvasRef.current,
        viewport
      );
      
      const newNodeId = `${nodeType.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newNode = {
        id: newNodeId,
        type: nodeType.id,
        data: { 
          label: nodeType.name,
          position: worldPos,
          size: {
            width: nodeType.width,
            height: nodeType.height,
          }
        },
        visual: {
          color: nodeType.color,
          shape: nodeType.shape,
          selected: false
        }
      };
      
      console.log('📦 Node dropped:', { newNode, worldPos, viewport });
      addNode(newNode);
      onNodeDropped?.(nodeType, worldPos);
      
    } catch (error) {
      console.error('❌ Drop error:', error);
    }
  }, [viewport, addNode, onNodeDropped]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (canvasRef.current) {
      canvasRef.current.style.backgroundColor = '#f0f8ff';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (canvasRef.current && !canvasRef.current.contains(e.relatedTarget as Node)) {
      canvasRef.current.style.backgroundColor = '';
    }
  }, []);

  // Helper function for debug display
  const getMaxDepth = (nodeInfo: any): number => {
    if (!nodeInfo || !nodeInfo.children) return nodeInfo?.depth || 0;
    
    return Math.max(
      nodeInfo.depth,
      ...nodeInfo.children.map((child: any) => getMaxDepth(child))
    );
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ 
          cursor: currentCursor,
          touchAction: 'none', // Critical for preventing browser's built-in touch gestures
          userSelect: 'none'   // Prevent text selection on mobile
        }}
        // Mouse events
        onPointerDown={handleMouseDown}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onPointerLeave={handleMouseLeave}
        
        // Touch events (these will be called instead of pointer events on mobile)
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        
        // Drag and drop
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      
      <div className={`relative ${className}`}>
        {showDebugInfo && (
          <div>
            <div>
              Initialized: {isRendererInitialized() ? 'Yes' : 'No'}, 
              Zoom: {viewport.zoom.toFixed(2)}x, 
              Position: ({viewport.x.toFixed(0)}, {viewport.y.toFixed(0)}), 
              Canvas Size: {viewport.width}x{viewport.height} (actual: {width}x{height})
              <div>
                Selected: {interaction.selectedNodes.length}, 
                Dragging: {interaction.dragState.isDragging ? interaction.dragState.dragType : 'No'}, 
                {interaction.dragState.resizeHandle && `Handle: ${interaction.dragState.resizeHandle}`}
                
                {/* Touch debug info */}
                {touchState.touches.size > 0 && (
                  <span>
                    , Touches: {touchState.touches.size}
                    {touchState.isPinching && ' (Pinching)'}
                  </span>
                )}
                
                {debugInfo && (
                  <span>
                    , Spatial Items: {debugInfo.totalItems}, 
                    Max Depth: {getMaxDepth(debugInfo.quadTreeInfo)}
                  </span>
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