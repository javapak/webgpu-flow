import React, { useRef, useEffect, useCallback } from 'react';
import { WebGPUDiagramRenderer } from '../renderers/WebGPURenderer';
import { DiagramContext, useDiagram } from '../context/DiagramContext';
import { MouseInteractions as InteractionUtils } from '../utils/MouseInteractions';

interface DiagramCanvasProps {
  width: number;
  height: number;
  className?: string;
}

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  width,
  height,
  className
}) => {
    
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGPUDiagramRenderer | null>(null);
  
  // Get everything from the diagram context

  // Initialize WebGPU renderer
  useEffect(() => {
    const initRenderer = async () => {
      if (!canvasRef.current) return;
      
      const renderer = new WebGPUDiagramRenderer();
      const success = await renderer.initialize(canvasRef.current, {width, height});
      
      if (success) {
        rendererRef.current = renderer;
        console.log('WebGPU renderer initialized successfully');
      } else {
        console.warn('WebGPU initialization failed, falling back to Canvas 2D');
        // TODO: Implement Canvas 2D fallback
      }
    };

    initRenderer();
  }, []);

    const { 
    state, 
    setViewport, 
    updateNodes,
    moveNode,
    interactionState,
    setInteractionState,
    setSelectedNodes
  } = useDiagram();

  // Render the diagram whenever state changes
  useEffect(() => {
    if (rendererRef.current && rendererRef.current.initialized) {
      rendererRef.current.render(state);
    }
  }, [state, state.nodes, interactionState]);

  // Force re-render on canvas resize
  useEffect(() => {
    if (rendererRef.current && rendererRef.current.initialized && canvasRef.current) {
      canvasRef.current.width = width;
      canvasRef.current.height = height;
      rendererRef.current.render(state);
    }
  }, [width, height, state]);

  // Mouse event handlers
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (!canvasRef.current) return;
    
    const worldPos = InteractionUtils.screenToWorld(
      event.clientX,
      event.clientY,
      canvasRef.current,
      state.viewport
    );
    
    const clickedNode = InteractionUtils.findNodeAtPosition(worldPos, state.nodes);
    
    if (clickedNode) {
      // Select and start dragging the node

      // deselect selected node (singular for now....will format as array if decide that should change.) upon new selection
      if (interactionState.selectedNodes.length === 1) // We know for now that length is always going to be 1 or 0 if we keep our conditions consistent...
        interactionState.selectedNodes[0].visual.selected = false;


      // trigger effect setting clickedNode
      setSelectedNodes([clickedNode]);
      setInteractionState((prev: any) => ({
        ...prev,
        mode: 'dragging',
        dragTarget: clickedNode.id,
        lastMousePos: worldPos
      }));
    } else {
      // Start panning
      setInteractionState((prev: any) => ({
        ...prev,
        mode: 'panning',
        dragTarget: null,
        lastMousePos: worldPos
      }));
    }
  }, [state.viewport, interactionState.selectedNodes, state.nodes, setSelectedNodes, setInteractionState]);

  useEffect(() => {
    // deselect node on canvas click....
    if (interactionState.mode === 'panning') {
      if (interactionState.selectedNodes.length === 1)
      interactionState.selectedNodes[0].visual.selected = false;
    
      setSelectedNodes([]);

    }

  }, [interactionState.mode]);
  
  useEffect(() => {
      if (interactionState.selectedNodes.length === 1)
      interactionState.selectedNodes[0].visual.selected = true;
  }, [interactionState.selectedNodes])

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!canvasRef.current || interactionState.mode === 'idle') return;
    
    const worldPos = InteractionUtils.screenToWorld(
      event.clientX,
      event.clientY,
      canvasRef.current,
      state.viewport
    );
    
    const deltaX = worldPos.x - interactionState.lastMousePos.x;
    const deltaY = worldPos.y - interactionState.lastMousePos.y;
    
    if (interactionState.mode === 'dragging' && interactionState.dragTarget) {
      // Move the selected node
      const currentNode = state.nodes.find((n: { id: any; }) => n.id === interactionState.dragTarget);
      if (currentNode) {
        const currentPos = currentNode.data.position || { x: 0, y: 0 };
        const newPos = {
          x: currentPos.x + deltaX,
          y: currentPos.y + deltaY
        };
        moveNode(interactionState.dragTarget, newPos);
      }
    } else if (interactionState.mode === 'panning') {
      // Pan the viewport - pass partial viewport object
      if (worldPos.x !== interactionState.lastMousePos.x && worldPos.y !== interactionState.lastMousePos.y) {
        setViewport({
            x: state.viewport.x - deltaX ,
            y: state.viewport.y - deltaY,
            zoom: state.viewport.zoom
        });
      }
    }
    
    setInteractionState((prev: any) => ({
      ...prev,
      lastMousePos: worldPos
    }));
  }, [state.viewport.x, state.viewport.y, state.nodes, interactionState, moveNode, setViewport, setInteractionState]);

  const handleMouseUp = useCallback(() => {
    setInteractionState((prev: any) => ({
      ...prev,
      mode: 'idle',
      dragTarget: null
    }));
  }, [setInteractionState]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    const zoomSpeed = 0.1;
    const zoomDelta = -event.deltaY * zoomSpeed * 0.01;
    const newZoom = Math.max(0.1, Math.min(3.0, state.viewport.zoom + zoomDelta));
    
    setViewport({
      zoom: newZoom
    });
  }, [state.viewport.zoom, setViewport]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp} // Stop interactions when mouse leaves canvas
      onWheel={handleWheel}
      style={{ 
        border: '1px solid #ccc',
        display: 'block',
        cursor: interactionState.mode === 'dragging' ? 'grabbing' : 
                interactionState.mode === 'panning' ? 'grabbing' : 'grab',
        ...({} as React.CSSProperties)
      }}
    />
  );
};