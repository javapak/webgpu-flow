import React, { useRef, useEffect, useCallback, useState } from 'react';
import { InteractionMode, useDiagram } from './DiagramProvider';
import { MouseInteractions, type ResizeHandle } from '../utils/MouseInteractions';
import type { DiagramNode } from '../types';
import {
  clampZoom, distance, fitContain, midpoint, pinchView, wheelZoomFactor, zoomAbout,
  type Point, type View,
} from '../utils/CanvasCoords';

interface DiagramCanvasProps {
  /** Size of the area the canvas may occupy; the canvas is letterboxed to fit inside it. */
  width: number;
  height: number;
  /** Backing-store size. Changing it resizes the render target; on-screen size is unaffected. */
  resolution: { width: number; height: number };
  className?: string;
  onNodeClick?: (node: any) => void;
  onNodeDropped?: (nodeType: any, position: {x: number, y: number}) => void;
  onNodeDoubleClick?: (node: any) => void;
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void;
  /** Palette item to place on the next tap. */
  selectedNodeType?: any;
  onPlaceNode?: (nodeType: any, position: {x: number, y: number}) => void;
  setSupportedSampleCount: React.Dispatch<React.SetStateAction<string[] | undefined>>
}

// How far (CSS px) a pointer must travel before a node/handle/vertex press becomes a drag.
// Fingers jitter more than mice, so touch gets a larger dead zone.
const DRAG_SLOP_CSS: Record<string, number> = { mouse: 3, pen: 5, touch: 8 };
// Delay before the ref-driven viewport is synced back into React state after a gesture.
const VIEWPORT_COMMIT_MS = 150;

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  width,
  height,
  className = '',
  onNodeClick,
  onCanvasClick,
  resolution,
  onNodeDropped,
  selectedNodeType,
  onPlaceNode,
  setSupportedSampleCount
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentCursor, setCurrentCursor] = useState<string>('grab');
  const initializationAttempted = useRef(false);

  // Gesture state lives in refs: it changes on every pointer event and must not re-render.
  const pointersRef = useRef(new Map<number, Point>());          // active pointers, canvas px
  const pinchRef = useRef<{ view: View; center: Point; distance: number } | null>(null);
  const dragPointerRef = useRef<number | null>(null);            // pointer that owns the current drag
  const pendingRef = useRef<{ start: Point; slop: number; committed: boolean } | null>(null);
  const hoverRef = useRef<{ pos: Point; raf: number | null }>({ pos: { x: 0, y: 0 }, raf: null });
  const commitTimerRef = useRef<number | null>(null);

  const {
    viewport,
    viewportRef,
    interaction,
    addNode,
    interactionRef,
    hitTestWithHandles,
    selectNode,
    selectEdge,
    clearVertexSelection,
    clearEdgeSelection,
    clearSelection,
    startDrag,
    updateDrag,
    selectEdgeVertex,
    startDrawing,
    drawingState,
    exitDrawMode,
    completeEdge,
    hitTestEdge,
    hitTestEdgeVertex,
    addControlPoint,
    setFocusedOnInput,
    focusedOnInput,
    endDrag,
    setViewport,
    cancelViewportAnimation,
    screenToWorld,
    clientToCanvas,
    getRenderer,
    initializeRenderer,
    isRendererInitialized,
    renderFrame,
    addEdge,
    mode
  } = useDiagram();

  // The backing store keeps its internal resolution (and aspect); the CSS box is the
  // largest box of that aspect that fits the container, so 1 CSS px maps linearly to canvas px.
  const cssSize = fitContain({ width, height }, resolution.width / resolution.height);
  // After mount the renderer owns the canvas's pixel size (it must recreate depth/MSAA targets
  // in step), so React only ever sets the initial attributes.
  const initialResolution = useRef(resolution).current;

  useEffect(() => {
    if (!canvasRef.current || initializationAttempted.current) {
      return;
    }

    const initCanvas = async () => {
      initializationAttempted.current = true;
      
      try {
        const success = await initializeRenderer(canvasRef.current!);
        
        if (success) {
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

  // Tell the viewport how the canvas is displayed. pixelRatio lets labels, handles and hit
  // tolerances stay a constant size on screen whatever the resolution or pane size.
  useEffect(() => {
    if (cssSize.width <= 0) return;
    setViewport({ width: cssSize.width, height: cssSize.height, pixelRatio: resolution.width / cssSize.width });
  }, [cssSize.width, cssSize.height, resolution.width, setViewport]);

  // Apply resolution changes. Zoom is scaled with the pixel count so the scene looks the same size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (canvas.width === resolution.width && canvas.height === resolution.height)) return;
    const previousWidth = canvas.width;
    void (async () => {
      const renderer = getRenderer();
      if (renderer?.initialized) {
        await renderer.setResolution(resolution);
      } else {
        canvas.width = resolution.width;
        canvas.height = resolution.height;
      }
      setViewport({ zoom: clampZoom(viewportRef.current.zoom * (canvas.width / previousWidth)) });
      renderFrame();
    })();
  }, [resolution, getRenderer, setViewport, viewportRef, renderFrame]);

  useEffect(() => {
    // Only render if initialized and not busy with resize/reconfiguration
    if (isRendererInitialized() && !getRenderer()?.isBusy && canvasRef.current) {
      const renderer = getRenderer();
      if (renderer && renderer.depthTexture) {
        requestAnimationFrame(() => {
          if (!renderer.isBusy) {
            renderFrame();
          }
        });
      }
    }
  }, [viewport.x, viewport.y, drawingState.isDrawing, drawingState.userVertices, 
      viewport.zoom, viewport.width, viewport.height, isRendererInitialized, 
      getRenderer, renderFrame]);

  useEffect(() => () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    if (hoverRef.current.raf !== null) cancelAnimationFrame(hoverRef.current.raf);
  }, []);

  // ---- helpers -------------------------------------------------------------

  const canvasPosOf = useCallback(
    (e: { clientX: number; clientY: number }) => clientToCanvas(e.clientX, e.clientY),
    [clientToCanvas],
  );

  const canvasSizeOf = () => ({ width: canvasRef.current?.width ?? 1, height: canvasRef.current?.height ?? 1 });

  /** Canvas px per CSS px (the canvas is usually displayed smaller than its backing store). */
  const canvasPerCss = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? (canvasRef.current!.width / rect.width) : 1;
  };

  /** Moves the viewport without touching React state; state is synced once the gesture settles. */
  const applyView = useCallback((view: View) => {
    viewportRef.current.x = view.x;
    viewportRef.current.y = view.y;
    viewportRef.current.zoom = view.zoom;
    renderFrame();
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      setViewport({}); // merges the ref and dispatches
    }, VIEWPORT_COMMIT_MS);
  }, [viewportRef, renderFrame, setViewport]);

  const cursorForDrag = (type: string | null, handle?: ResizeHandle) => {
    if (type === 'resize') return MouseInteractions.getCursorForHandle(handle ?? 'none');
    if (type === 'node' || type === 'edge-vertex') return 'move';
    return 'grabbing';
  };

  /** Starts a drag owned by `pointerId`. Non-viewport drags wait for the slop distance before moving. */
  const beginDrag = useCallback((
    type: 'node' | 'viewport' | 'resize' | 'edge-vertex',
    pos: Point,
    pointerId: number,
    pointerType: string,
    resizeHandle?: ResizeHandle,
    edgeId?: string,
    vertexIndex?: number,
  ) => {
    startDrag(type, pos, resizeHandle, edgeId, vertexIndex);
    dragPointerRef.current = pointerId;
    pendingRef.current = type === 'viewport'
      ? null
      : { start: pos, slop: (DRAG_SLOP_CSS[pointerType] ?? 5) * canvasPerCss(), committed: false };
    if (mode !== InteractionMode.DRAW_EDGE) setCurrentCursor(cursorForDrag(type, resizeHandle));
  }, [startDrag, mode]);

  const finishDrag = useCallback(() => {
    if (interactionRef.current.dragState.isDragging) endDrag();
    dragPointerRef.current = null;
    pendingRef.current = null;
  }, [endDrag, interactionRef]);

  // ---- pointer input (mouse, touch and pen share one path) ------------------

  const beginPinch = useCallback(() => {
    const [a, b] = [...pointersRef.current.values()];
    finishDrag(); // a half-started node drag shouldn't fight the pinch
    pinchRef.current = {
      view: { x: viewportRef.current.x, y: viewportRef.current.y, zoom: viewportRef.current.zoom },
      center: midpoint(a, b),
      distance: distance(a, b),
    };
  }, [finishDrag, viewportRef]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Left button (or any touch/pen contact) interacts; middle button pans; right is left alone.
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    cancelViewportAnimation();

    if (focusedOnInput) setFocusedOnInput(false);
    canvas.setPointerCapture(e.pointerId);

    const pos = canvasPosOf(e);
    pointersRef.current.set(e.pointerId, pos);

    if (pointersRef.current.size === 2) { beginPinch(); return; }
    if (pointersRef.current.size > 2) return;

    if (e.pointerType === 'mouse' && e.button === 1) {
      beginDrag('viewport', pos, e.pointerId, e.pointerType);
      return;
    }

    const worldPos = screenToWorld(pos);

    // Tap-to-place a palette item
    if (selectedNodeType && onPlaceNode) {
      onPlaceNode(selectedNodeType, worldPos);
      if (navigator.vibrate) navigator.vibrate(50);
      return;
    }

    // Edge drawing mode
    if (mode === InteractionMode.DRAW_EDGE) {
      const nodes = hitTestWithHandles(pos).nodes;
      if (nodes.length > 0 && !drawingState.isDrawing) {
        startDrawing(nodes[0].id);
      } else if (drawingState.isDrawing && nodes.length === 0) {
        addControlPoint(worldPos);
      } else if (drawingState.isDrawing && nodes.length > 0 && nodes[0].id !== drawingState.sourceNodeId) {
        const edge = completeEdge(nodes[0].id);
        if (edge) addEdge(edge);
        exitDrawMode();
      }
      return;
    }
    if (drawingState.isDrawing) return;

    // Selection, most specific target first:
    // resize handle > vertex of the selected edge > node > edge > empty canvas.
    const { nodes, resizeHandle } = hitTestWithHandles(pos);
    if (resizeHandle !== 'none') {
      beginDrag('resize', pos, e.pointerId, e.pointerType, resizeHandle);
      return;
    }

    const selectedEdge = interaction.selectedEdges[0];
    if (selectedEdge) {
      const vertexIndex = hitTestEdgeVertex(pos, selectedEdge);
      if (vertexIndex !== -1) {
        clearVertexSelection();
        selectEdgeVertex(selectedEdge.id, vertexIndex);
        beginDrag('edge-vertex', pos, e.pointerId, e.pointerType, undefined, selectedEdge.id, vertexIndex);
        return;
      }
    }

    if (nodes.length > 0) {
      const topNode = nodes[0];
      clearEdgeSelection();
      clearVertexSelection();
      if (interaction.selectedNodes[0]?.id !== topNode.id) {
        clearSelection();
        selectNode(topNode);
      }
      beginDrag('node', pos, e.pointerId, e.pointerType);
      onNodeClick?.(topNode);
      return;
    }

    const edgeHit = hitTestEdge(pos);
    clearSelection();
    clearVertexSelection();
    if (edgeHit.edge) {
      selectEdge(edgeHit.edge);
    } else {
      clearEdgeSelection();
      onCanvasClick?.(worldPos);
    }
    // Pressing empty space (or an edge) and dragging pans the view.
    beginDrag('viewport', pos, e.pointerId, e.pointerType);
  }, [canvasPosOf, cancelViewportAnimation, focusedOnInput, setFocusedOnInput, beginPinch, beginDrag, screenToWorld, selectedNodeType,
      onPlaceNode, mode, hitTestWithHandles, drawingState, startDrawing, addControlPoint, completeEdge,
      addEdge, exitDrawMode, interaction.selectedEdges, interaction.selectedNodes, hitTestEdgeVertex,
      clearVertexSelection, selectEdgeVertex, clearEdgeSelection, clearSelection, selectNode, onNodeClick,
      hitTestEdge, selectEdge, onCanvasClick]);

  const updateHoverCursor = useCallback(() => {
    hoverRef.current.raf = null;
    if (mode === InteractionMode.DRAW_EDGE || interactionRef.current.dragState.isDragging) return;
    const pos = hoverRef.current.pos;
    const { nodes, resizeHandle } = hitTestWithHandles(pos);
    let cursor = 'grab';
    if (resizeHandle !== 'none') cursor = MouseInteractions.getCursorForHandle(resizeHandle);
    else if (nodes.length > 0 || hitTestEdge(pos).edge) cursor = 'pointer';
    setCurrentCursor(cursor);
  }, [mode, hitTestWithHandles, hitTestEdge, interactionRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const pos = canvasPosOf(e);
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, pos);

    // Two fingers: pan and zoom together, anchored between the fingers.
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) return;
      const [a, b] = [...pointersRef.current.values()];
      const start = pinchRef.current;
      applyView(pinchView(start.view, canvasSizeOf(), start.center, start.distance, midpoint(a, b), distance(a, b)));
      return;
    }

    if (mode === InteractionMode.DRAW_EDGE && drawingState.isDrawing) {
      addControlPoint(screenToWorld(pos), drawingState.userVertices.length > 0);
      return;
    }

    if (interactionRef.current.dragState.isDragging && dragPointerRef.current === e.pointerId) {
      const pending = pendingRef.current;
      if (pending && !pending.committed) {
        if (distance(pos, pending.start) < pending.slop) return; // still a press, not a drag
        pending.committed = true;
      }
      updateDrag(pos); // lastPos is still the press point, so the first move carries the full delta
      return;
    }

    if (e.pointerType === 'mouse' && pointersRef.current.size === 0) {
      hoverRef.current.pos = pos;
      if (hoverRef.current.raf === null) hoverRef.current.raf = requestAnimationFrame(updateHoverCursor);
    }
  }, [canvasPosOf, applyView, mode, drawingState, addControlPoint, screenToWorld, interactionRef, updateDrag, updateHoverCursor]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);

    if (pinchRef.current) {
      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
        // Lifting one finger of a pinch keeps panning with the other.
        const [remaining] = [...pointersRef.current.entries()];
        if (remaining) beginDrag('viewport', remaining[1], remaining[0], e.pointerType);
      }
      return;
    }

    if (dragPointerRef.current === e.pointerId) {
      finishDrag();
      if (mode !== InteractionMode.DRAW_EDGE) setCurrentCursor('grab');
    }
  }, [beginDrag, finishDrag, mode]);

  // Mouse wheel / trackpad scroll and pinch zoom about the cursor. Needs a non-passive
  // native listener so preventDefault() can stop the page from scrolling or zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelViewportAnimation();
      const anchor = clientToCanvas(e.clientX, e.clientY);
      const view = viewportRef.current;
      applyView(zoomAbout(view, { width: canvas.width, height: canvas.height }, anchor, view.zoom * wheelZoomFactor(e)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [clientToCanvas, viewportRef, applyView, cancelViewportAnimation]);

  useEffect(() => {
    setCurrentCursor(mode === InteractionMode.DRAW_EDGE ? 'crosshair' : 'grab');
  }, [mode]);

  // ---- drag and drop from the palette --------------------------------------

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
      const worldPos = screenToWorld(clientToCanvas(e.clientX, e.clientY));

      const newNode: DiagramNode = {
        id: `${nodeType.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        type: nodeType.id,
        data: { 
          label: nodeType.name,
          position: worldPos,
          size: { width: nodeType.width, height: nodeType.height }
        },
        visual: {
          labelFont: 'Arial',
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
  }, [screenToWorld, clientToCanvas, addNode, onNodeDropped]);


  return (
    <div className={className} style={{ position: 'relative', width: `${width}px`, height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas
        ref={canvasRef}
        width={initialResolution.width}
        height={initialResolution.height}
        style={{
          width: `${cssSize.width}px`,
          height: `${cssSize.height}px`,
          cursor: currentCursor,
          // Stop the browser from claiming touches for scrolling/zooming; we handle every gesture.
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          backgroundColor: selectedNodeType ? '#f0f8ff' : 'transparent'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />

      {selectedNodeType && (
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
    </div>
  );
};
