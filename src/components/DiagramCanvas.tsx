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
}

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  width,
  height,
  className = '',
  showDebugInfo = false,
  onNodeClick,
  onNodeDoubleClick,
  onCanvasClick,
  onNodeDropped,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const initializationAttempted = useRef(false);

  const {
    viewport,
    interaction,
    addNode,
    hitTestPoint,
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

  useEffect(() => {
    if (isRendererInitialized() && canvasRef.current) {
      console.log('🔄 VIEWPORT CHANGED, triggering render:', {
        x: viewport.x,
        y: viewport.y, 
        zoom: viewport.zoom
      });
      renderFrame();
    }
  }, [viewport.x, viewport.y, viewport.zoom, isRendererInitialized, renderFrame]);
  

  // Update viewport size when canvas size changes
  useEffect(() => {
    setViewport({ width, height });
  }, [width, height, setViewport]);

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

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    console.log('🖱️ Mouse down');
    const canvasPos = getCanvasMousePos(e);
    
    // Convert to world coordinates for hit testing
    const worldPos = screenToWorld(canvasPos);
    const hitNodes = hitTestPoint(canvasPos); // This should use canvas coordinates internally
    
    console.log('Mouse down:', { canvasPos, worldPos, viewport });

    if (hitNodes.length > 0) {
      const topNode = hitNodes[0];
      console.log('🎯 Node hit:', topNode.id);
      selectNode(topNode);
      startDrag('node', canvasPos);
      onNodeClick?.(topNode);
    } else {
      console.log('🌍 Canvas hit');
      clearSelection();
      startDrag('viewport', canvasPos);
      onCanvasClick?.(worldPos);
    }
  }, [getCanvasMousePos, screenToWorld, hitTestPoint, selectNode, startDrag, clearSelection, onNodeClick, onCanvasClick, viewport]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (interaction.dragState.isDragging) {
      const canvasPos = getCanvasMousePos(e);
      updateDrag(canvasPos);
    }
  }, [interaction.dragState.isDragging, getCanvasMousePos, updateDrag]);

  const handleMouseUp = useCallback(() => {
    if (interaction.dragState.isDragging) {
      endDrag();
    }
  }, [interaction.dragState.isDragging, endDrag]);

  const handleMouseLeave = useCallback(() => {
    if (interaction.dragState.isDragging) {
      endDrag();
    }
  }, [interaction.dragState.isDragging, endDrag]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvasPos = getCanvasMousePos(e);
    const hitNodes = hitTestPoint(canvasPos);
    
    if (hitNodes.length > 0) {
      onNodeDoubleClick?.(hitNodes[0]);
    }
  }, [getCanvasMousePos, hitTestPoint, onNodeDoubleClick]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const canvasPos = getCanvasMousePos(e);
    const worldPosBeforeZoom = screenToWorld(canvasPos);
    
    // Calculate zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom * zoomFactor));
    
    // Calculate new viewport position to keep mouse point fixed
    const worldPosAfterZoom = {
      x: (canvasPos.x - width / 2) / newZoom + viewport.x,
      y: (canvasPos.y - height / 2) / newZoom + viewport.y,
    };
    
    const deltaX = worldPosAfterZoom.x - worldPosBeforeZoom.x;
    const deltaY = worldPosAfterZoom.y - worldPosBeforeZoom.y;
    
    setViewport({
      zoom: newZoom,
      x: viewport.x + deltaX,
      y: viewport.y + deltaY,
    });
  }, [getCanvasMousePos, screenToWorld, viewport, width, height, setViewport]);

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
      <div className={`relative ${className}`}>
              {showDebugInfo && (
          <div>
            <div>Initialized: {isRendererInitialized() ? 'Yes' : 'No'}, Zoom: {viewport.zoom.toFixed(2)}x, Position: ({viewport.x.toFixed(0)}, {viewport.y.toFixed(0)}), Canvas Size: {width}x{height} <div>Selected: {interaction.selectedNodes.length}, {debugInfo && (<span>Spatial Items: {debugInfo.totalItems}, Max Depth: {getMaxDepth(debugInfo.quadTreeInfo)}</span>)}</div>
            </div>
          </div>
        )}
      </div>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="border border-gray-300 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />
      </div>

  );
};

// Performance monitoring component
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