// components/SpatialDiagramCanvas.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useDiagram } from './DiagramProvider';
import { MouseInteractions } from '../utils/MouseInteractions';

interface SpatialDiagramCanvasProps {
  width: number;
  height: number;
  className?: string;
  showDebugInfo?: boolean;
  onNodeClick?: (node: any) => void;
  onNodeDropped?: (nodeType: any, position: {x: number, y: number}) => void;
  onNodeDoubleClick?: (node: any) => void;
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void;
}

export const DiagramCanvas: React.FC<SpatialDiagramCanvasProps> = ({
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
  const debugInfoRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(null);
  
  const {
    viewport,
    interaction,
    addNode,
    getVisibleNodes,
    hitTestPoint,
    selectNode,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    setViewport,
    screenToWorld,
    worldToScreen,
    getSpatialDebugInfo,
  } = useDiagram();

  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [performanceStats, setPerformanceStats] = useState({
    visibleNodes: 0,
    totalNodes: 0,
    renderTime: 0,
    hitTestTime: 0,
  });

  // Update viewport size
  useEffect(() => {
    setViewport({ width, height });
  }, [width, height, setViewport]);

  // Canvas drawing function with spatial optimization
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const startTime = performance.now();

    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Set up viewport transformation
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-viewport.x, -viewport.y);

    // Get only visible nodes using spatial index
    const visibleNodes = getVisibleNodes();
    
    // Draw nodes
    visibleNodes.forEach((node) => {
      const isSelected = interaction.selectedNodes.some(selected => selected.id === node.id);
      drawNode(ctx, node, isSelected);
    });

    ctx.restore();

    // Draw selection box if dragging
    if (interaction.dragState.isDragging && interaction.dragState.dragType === 'viewport') {
      drawViewportDragIndicator(ctx);
    }

    const renderTime = performance.now() - startTime;

    // Update performance stats
    setPerformanceStats(prev => ({
      ...prev,
      visibleNodes: visibleNodes.length,
      renderTime,
    }));

    // Update debug info if enabled
    if (showDebugInfo) {
      setDebugInfo(getSpatialDebugInfo());
    }
  }, [
    width,
    height,
    viewport,
    interaction,
    getVisibleNodes,
    getSpatialDebugInfo,
    showDebugInfo,
  ]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      draw();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  // Mouse event handlers with spatial hit testing
  const getMousePos = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const mousePos = getMousePos(e);
    const hitTestStart = performance.now();
    const hitNodes = hitTestPoint(mousePos);
    const hitTestTime = performance.now() - hitTestStart;

    setPerformanceStats(prev => ({ ...prev, hitTestTime }));

    if (hitNodes.length > 0) {
      // Node hit - start node drag
      const topNode = hitNodes[0]; // Spatial index returns sorted by area
      selectNode(topNode);
      startDrag('node', mousePos);
      onNodeClick?.(topNode);
    } else {
      // Canvas hit - start viewport pan
      clearSelection();
      startDrag('viewport', mousePos);
      const worldPoint = screenToWorld(mousePos);
      onCanvasClick?.(worldPoint);
    }
  }, [
    getMousePos,
    hitTestPoint,
    selectNode,
    startDrag,
    clearSelection,
    screenToWorld,
    onNodeClick,
    onCanvasClick,
  ]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (interaction.dragState.isDragging) {
      const mousePos = getMousePos(event);
      updateDrag(mousePos);
    }
  }, [interaction.dragState.isDragging, getMousePos, updateDrag]);

  const handleMouseUp = useCallback(() => {
    if (interaction.dragState.isDragging) {
      endDrag();
    }
  }, [interaction.dragState.isDragging, endDrag]);

   const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    
    if (!canvasRef.current) return;
    
    try {
      // Get the dropped node type data
      const nodeTypeData = event.dataTransfer.getData('application/node-type');
      if (!nodeTypeData) return;
      
      const nodeType: any = JSON.parse(nodeTypeData);
      
      // Convert drop position to world coordinates
      const worldPos = MouseInteractions.screenToWorld(
        event.clientX,
        event.clientY,
        canvasRef.current,
        viewport
      );
      
      // Generate unique ID for the new node
      const newNodeId = `${nodeType.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Create new node
      const newNode = {
        id: newNodeId,
        type: nodeType.id,
        data: { 
          label: nodeType.name,
          position: worldPos 
        },
        visual: {
          width: nodeType.width,
          height: nodeType.height,
          color: nodeType.color,
          shape: nodeType.shape,
          selected: false
        }
      };
      
      // Add the node to the diagram
      addNode(newNode);
      
      // Call optional callback
      if (onNodeDropped) {
        onNodeDropped(nodeType, worldPos);
      }
      
      console.log('Node dropped:', newNode);
      
    } catch (error) {
      console.error('Error handling node drop:', error);
    }
  }, [viewport, addNode, onNodeDropped]);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    // Add visual feedback when drag enters canvas
    if (canvasRef.current) {
      canvasRef.current.style.backgroundColor = '#f0f8ff';
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Remove visual feedback when drag leaves canvas
    if (canvasRef.current && !canvasRef.current.contains(event.relatedTarget as Node)) {
      canvasRef.current.style.backgroundColor = '';
    }
  }, []);



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
    
    const mousePos = getMousePos(e);
    const worldPosBeforeZoom = screenToWorld(mousePos);
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, viewport.zoom * zoomFactor));
    
    // Calculate new viewport position to keep mouse point stable
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

  // Drawing helper functions
  const drawNode = (ctx: CanvasRenderingContext2D, node: any, isSelected: boolean) => {
    const { x, y } = node.data.position;
    const size = node.data.size || { width: 100, height: 60 };
    const color = node.visual?.color || '#3b82f6';
    
    ctx.save();
    
    // Draw node body
    ctx.fillStyle = color;
    ctx.fillRect(
      x - size.width / 2,
      y - size.height / 2,
      size.width,
      size.height
    );
    
    // Draw border
    ctx.strokeStyle = isSelected ? '#ef4444' : '#1f2937';
    ctx.lineWidth = isSelected ? 3 : 1;
    ctx.strokeRect(
      x - size.width / 2,
      y - size.height / 2,
      size.width,
      size.height
    );
    
    // Draw label
    if (node.data.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.data.label, x, y);
    }
    
    ctx.restore();
  };

  const drawViewportDragIndicator = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(10, 10, width - 20, height - 20);
    ctx.restore();
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
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />
      
      {showDebugInfo && (
        <div
          ref={debugInfoRef}
          className="absolute top-2 left-2 bg-black bg-opacity-75 text-white text-xs p-2 rounded font-mono"
        >
          <div>Visible: {performanceStats.visibleNodes} nodes</div>
          <div>Render: {performanceStats.renderTime.toFixed(2)}ms</div>
          <div>Hit Test: {performanceStats.hitTestTime.toFixed(2)}ms</div>
          <div>Zoom: {viewport.zoom.toFixed(2)}x</div>
          <div>Position: ({viewport.x.toFixed(0)}, {viewport.y.toFixed(0)})</div>
          {debugInfo && (
            <div className="mt-2 border-t border-gray-600 pt-2">
              <div>QuadTree Depth: {getMaxDepth(debugInfo.quadTreeInfo)}</div>
              <div>Total Items: {debugInfo.totalItems}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Helper function to calculate max depth from debug info
const getMaxDepth = (nodeInfo: any): number => {
  if (!nodeInfo.children) return nodeInfo.depth;
  
  return Math.max(
    nodeInfo.depth,
    ...nodeInfo.children.map((child: any) => getMaxDepth(child))
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
  
  if (!stats) return null;
  
  return (
    <div className={`bg-gray-100 p-4 rounded ${className}`}>
      <h3 className="text-lg font-semibold mb-2">Spatial Index Performance</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="font-medium">Total Nodes:</span> {stats.totalItems}
        </div>
        <div>
          <span className="font-medium">Max Depth:</span> {getMaxDepth(stats.quadTreeInfo)}
        </div>
      </div>
    </div>
  );
};

