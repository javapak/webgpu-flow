import { canShowResizeHandles } from './CanvasCoords';
import type { NodeSchema } from "../types";
import type { DiagramNode } from "./SpatialIndex";
import type { DiagramNode as GeometryNode } from "../types";
import { resizeHandles } from './NodeGeometry';

export type ResizeHandle = 'none' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export class MouseInteractions {
  /** Screen (CSS px relative to the canvas) to world coordinates. */
  static screenToWorld(
    screenX: number, 
    screenY: number, 
    canvas: HTMLCanvasElement, 
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): { x: number; y: number } {
;
  
  if (!canvas) {
    return { x: 0, y: 0 };
  }

  const rect = canvas.getBoundingClientRect();
  
  // CSS px -> canvas backing-store px
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const canvasX = screenX * scaleX;
  const canvasY = screenY * scaleY;
  
  const screenCenterX = rect.width / 2;
  const screenCenterY = rect.height / 2;
  
  const worldX = (canvasX - screenCenterX) / viewport.zoom + viewport.x;
  const worldY = (canvasY - screenCenterY) / viewport.zoom + viewport.y;
  
  return { x: worldX, y: worldY };
  }

  /** World to screen coordinates. */
  static worldToScreen(
    worldX: number,
    worldY: number,
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): { x: number; y: number } {
    const screenCenterX = viewport.width / 2;
    const screenCenterY = viewport.height / 2;
    
    const screenX = (worldX - viewport.x) * viewport.zoom + screenCenterX;
    const screenY = (worldY - viewport.y) * viewport.zoom + screenCenterY;
    
    return { x: screenX, y: screenY };
  }

  /** Whether a world point is inside a node's bounds. */
  static isPointInNode(
    worldPos: { x: number; y: number },
    node: DiagramNode
  ): boolean {
    const nodeX = node.data.position?.x || 0;
    const nodeY = node.data.position?.y || 0;
    const width = node.visual!.size?.width || 120;
    const height = node.visual!.size?.height || 80;
    
    const left = nodeX - width / 2;
    const right = nodeX + width / 2;
    const top = nodeY - height / 2;
    const bottom = nodeY + height / 2;
    
    return worldPos.x >= left && 
           worldPos.x <= right && 
           worldPos.y >= top && 
           worldPos.y <= bottom;
  }

static getResizeHandle(
  worldPos: { x: number; y: number },
  node: NodeSchema,
  viewport: { x: number; y: number; zoom: number; width: number; height: number; pixelRatio?: number }
): ResizeHandle {
  if (!node.visual?.selected) {
    return 'none';
  }

  const width = node.visual.size?.width || 120;
  const height = node.visual.size?.height || 80;
  const pixelRatio = viewport.pixelRatio ?? 1;
  if (!canShowResizeHandles({ width, height }, viewport.zoom, pixelRatio)) {
    return 'none';
  }

  // Handle detection threshold in world coordinates (adjusted for zoom)
  const handleSize = Math.max((12 * pixelRatio) / viewport.zoom, 8); // 12 CSS px, minimum 8 world units

  // The same handles the renderer draws, on the node's outline.
  for (const { handle, x, y } of resizeHandles(node as unknown as GeometryNode)) {
    if (Math.hypot(worldPos.x - x, worldPos.y - y) <= handleSize) return handle;
  }
  return 'none';
}


  /** CSS cursor for a resize handle. */
  static getCursorForHandle(handle: ResizeHandle): string {
    switch (handle) {
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'nw':
      case 'se':
        return 'nwse-resize';
      default:
        return 'grab';
    }
  }

  /** Topmost node at a world point. */
  static findNodeAtPosition(
    worldPos: { x: number; y: number },
    nodes: DiagramNode[]
  ): DiagramNode | null {
    // Iterate in reverse order to check topmost nodes first
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (this.isPointInNode(worldPos, nodes[i])) {
        return nodes[i];
      }
    }
    return null;
  }

  /** Shape name to the renderer's shape index. */
  private static getShapeType(shape?: string): number {
    const SHAPE_TYPES = {
      rectangle: 0,
      circle: 1,
      diamond: 2,
      hexagon: 3,
      package: 4,
      roundedRectangle: 5,
      initialNode: 6,
      finalNode: 7,
      oval: 8,
      actor: 9
    } as const;
    
    return SHAPE_TYPES[shape as keyof typeof SHAPE_TYPES] ?? 0;
  }

  /**
   * The node's box after dragging `handle` by (deltaX, deltaY) from its
   * original geometry. The dragged sides follow the pointer and the opposite
   * sides stay put; positions are centres. With `lockAspectRatio`, a corner
   * scales by the larger of its two changes and a side scales the other axis
   * about the centre.
   */
  static calculateResize(
    handle: ResizeHandle,
    deltaX: number,
    deltaY: number,
    currentWidth: number,
    currentHeight: number,
    currentX: number,
    currentY: number,
    minWidth: number = 40,
    minHeight: number = 30,
    lockAspectRatio: boolean = false
  ): { width: number; height: number; x: number; y: number } {
    const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
    let width = sx ? Math.max(minWidth, currentWidth + sx * deltaX) : currentWidth;
    let height = sy ? Math.max(minHeight, currentHeight + sy * deltaY) : currentHeight;

    if (lockAspectRatio) {
      const minScale = Math.max(minWidth / currentWidth, minHeight / currentHeight);
      const scale = Math.max(minScale, sx && sy
        ? Math.max(width / currentWidth, height / currentHeight)
        : sx ? width / currentWidth : height / currentHeight);
      width = currentWidth * scale;
      height = currentHeight * scale;
    }

    // Move the centre by half the growth, toward the dragged side.
    return {
      width,
      height,
      x: currentX + (sx * (width - currentWidth)) / 2,
      y: currentY + (sy * (height - currentHeight)) / 2,
    };
  }

  /** Whether resizing this shape keeps its aspect ratio. */
  static shouldLockAspectRatio(shape?: string): boolean {
    const shapeType = this.getShapeType(shape);
    return shapeType === 1 || shapeType === 6 || shapeType === 7; // Circle, Initial, Final
  }

  /** Drag event position to world coordinates. */
  static dragEventToWorld(
    event: React.DragEvent,
    canvas: HTMLCanvasElement,
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): { x: number; y: number } {

    

    return this.screenToWorld(event.clientX, event.clientY, canvas, viewport);
  }

  /** Mouse position relative to the canvas. */
  static getCanvasMousePosition(
    event: MouseEvent | DragEvent,
    canvas: HTMLCanvasElement
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }
}