// Enhanced mobile touch handling for DiagramCanvas
import React, { useCallback, useState } from 'react';
import { useDiagram } from '../components/DiagramProvider';


interface TouchState {
  active: boolean;
  identifier: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
}

interface MultiTouchState {
  touches: Map<number, TouchState>;
  isPinching: boolean;
  initialDistance: number;
  initialZoom: number;
  initialCenterX: number;
  initialCenterY: number;
}

export const useMobileTouch = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  viewport: any,
  interaction: any,
  onNodeClick?: (node: any) => void,
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void,
) => {
  const [touchState, setTouchState] = useState<MultiTouchState>({
    touches: new Map(),
    isPinching: false,
    initialDistance: 0,
    initialZoom: 1,
    initialCenterX: 0,
    initialCenterY: 0,
  });

  const {
    hitTestWithHandles,
    selectNode,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    setViewport,
    screenToWorld,
  } = useDiagram();

  // Helper functions
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
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  };

  // Touch event handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    const touches = Array.from(e.touches);
    console.log('🤏 Touch start:', touches.length, 'touches');

    if (touches.length === 1) {
      // Single touch - potential tap or drag
      const touch = touches[0];
      const canvasPos = getCanvasTouchPos(touch as Touch);
      const hitResult = performHitTest(canvasPos);
      
      const newTouchState: TouchState = {
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
        const newZoom = Math.max(0.1, Math.min(5, touchState.initialZoom * zoomFactor));
        
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
        const distance = Math.sqrt(
          Math.pow(touchInfo.currentX - touchInfo.startX, 2) +
          Math.pow(touchInfo.currentY - touchInfo.startY, 2)
        );
        
        const isTap = duration < 300 && distance < 10;
        console.log('👆 Potential tap:', { duration, distance, isTap });
        
        if (isTap) {
          // Handle tap - this is already handled in touchStart, so we just ensure drag ends
          if (interaction.dragState.isDragging) {
            endDrag();
          }
        }
      }
    }

    // End drag if no touches remain
    if (remainingTouches.length === 0) {
      if (interaction.dragState.isDragging) {
        console.log('🤏 Ending drag - no touches');
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

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    touchState,
  };
};