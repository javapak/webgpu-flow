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
  const [webGPUSupported, setWebGPUSupported] = useState<boolean | null>(null);
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
        setWebGPUSupported(success);
        
        if (success) {
          console.log('✅ DiagramCanvas: WebGPU initialized');
        } else {
          console.warn('⚠️ DiagramCanvas: WebGPU failed');
        }
      } catch (error) {
        console.error('❌ DiagramCanvas: Init error:', error);
        setWebGPUSupported(false);
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

  // Mouse position helper
  const getMousePos = useCallback((e: React.MouseEvent) => {
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
    const mousePos = getMousePos(e);
    const hitNodes = hitTestPoint(mousePos);

    if (hitNodes.length > 0) {
      const topNode = hitNodes[0];
      console.log('🎯 Node hit:', topNode.id);
      selectNode(topNode);
      startDrag('node', mousePos);
      onNodeClick?.(topNode);
    } else {
      console.log('🌍 Canvas hit');
      clearSelection();
      startDrag('viewport', mousePos);
      const worldPoint = screenToWorld(mousePos);
      onCanvasClick?.(worldPoint);
    }
  }, [getMousePos, hitTestPoint, selectNode, startDrag, clearSelection, screenToWorld, onNodeClick, onCanvasClick]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (interaction.dragState.isDragging) {
      const mousePos = getMousePos(e);
      updateDrag(mousePos);
    }
  }, [interaction.dragState.isDragging, getMousePos, updateDrag]);

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
    const mousePos = getMousePos(e);
    const hitNodes = hitTestPoint(mousePos);
    
    if (hitNodes.length > 0) {
      onNodeDoubleClick?.(hitNodes[0]);
    }
  }, [getMousePos, hitTestPoint, onNodeDoubleClick]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const mousePos = getMousePos(e);
    const worldPosBeforeZoom = screenToWorld(mousePos);
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom * zoomFactor));
    
    const worldPosAfterZoom = {
      x: (mousePos.x - width / 2) / newZoom + viewport.x,
      y: (mousePos.y - height / 2) / newZoom + viewport.y,
    };
    
    const deltaX = worldPosAfterZoom.x - worldPosBeforeZoom.x;
    const deltaY = worldPosAfterZoom.y - worldPosBeforeZoom.y;
    
    setViewport({
      zoom: newZoom,
      x: viewport.x + deltaX,
      y: viewport.y + deltaY,
    });
  }, [getMousePos, screenToWorld, viewport, width, height, setViewport]);

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
      
      const worldPos = MouseInteractions.screenToWorld(
        e.clientX,
        e.clientY,
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
      
      console.log('📦 Node dropped:', newNode.id);
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
    <div className={`relative ${className}`}>
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
      
      {showDebugInfo && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white text-xs p-2 rounded font-mono">
          <div>Renderer: {webGPUSupported === null ? 'Initializing...' : webGPUSupported ? 'WebGPU' : 'Failed'}</div>
          <div>Initialized: {isRendererInitialized() ? 'Yes' : 'No'}</div>
          <div>Zoom: {viewport.zoom.toFixed(2)}x</div>
          <div>Position: ({viewport.x.toFixed(0)}, {viewport.y.toFixed(0)})</div>
          <div>Selected: {interaction.selectedNodes.length}</div>
          {debugInfo && (
            <div className="mt-2 border-t border-gray-600 pt-2">
              <div>Spatial Items: {debugInfo.totalItems}</div>
              <div>Max Depth: {getMaxDepth(debugInfo.quadTreeInfo)}</div>
            </div>
          )}
        </div>
      )}
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