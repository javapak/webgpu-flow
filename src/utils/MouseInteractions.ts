import type { NodeSchema } from "../types";

export type ResizeHandle = 'none' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export class MouseInteractions {
  // Convert screen coordinates to world coordinates
  static screenToWorld(
    screenX: number, 
    screenY: number, 
    canvas: HTMLCanvasElement, 
    viewport: { x: number; y: number; zoom: number }
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;
    
    // Convert canvas coordinates to world coordinates
    const worldX = (canvasX / viewport.zoom) + viewport.x;
    const worldY = (canvasY / viewport.zoom) + viewport.y;
    
    return { x: worldX, y: worldY };
  }

  // Check if a point is inside a node's bounds
  static isPointInNode(
    worldPos: { x: number; y: number },
    node: NodeSchema
  ): boolean {
    const nodeX = node.data.position?.x || 0;
    const nodeY = node.data.position?.y || 0;
    const width = node.visual.size?.width || 120;
    const height = node.visual.size?.height || 80;
    
    const left = nodeX - width / 2;
    const right = nodeX + width / 2;
    const top = nodeY - height / 2;
    const bottom = nodeY + height / 2;
    
    return worldPos.x >= left && 
           worldPos.x <= right && 
           worldPos.y >= top && 
           worldPos.y <= bottom;
  }

  // Check if a point is near a resize handle of a selected node
  static getResizeHandle(
    worldPos: { x: number; y: number },
    node: NodeSchema,
    viewport: { x: number; y: number; zoom: number }
  ): ResizeHandle {
    if (!node.visual.selected) {
      return 'none';
    }

    const nodeX = node.data.position?.x || 0;
    const nodeY = node.data.position?.y || 0;
    const width = node.visual.size?.width || 120;
    const height = node.visual.size?.height || 80;
    
    // Get node bounds in world coordinates
    const left = nodeX - width / 2;
    const right = nodeX + width / 2;
    const top = nodeY - height / 2;
    const bottom = nodeY + height / 2;
    
    // Handle detection threshold in world coordinates (adjusted for zoom)
    const handleSize = 8 / viewport.zoom; // 8 pixels in screen space converted to world space
    
    // Check corners first (they take priority)
    if (Math.abs(worldPos.x - left) <= handleSize && Math.abs(worldPos.y - top) <= handleSize) {
      return 'nw';
    }
    if (Math.abs(worldPos.x - right) <= handleSize && Math.abs(worldPos.y - top) <= handleSize) {
      return 'ne';
    }
    if (Math.abs(worldPos.x - left) <= handleSize && Math.abs(worldPos.y - bottom) <= handleSize) {
      return 'sw';
    }
    if (Math.abs(worldPos.x - right) <= handleSize && Math.abs(worldPos.y - bottom) <= handleSize) {
      return 'se';
    }
    
    // Check edges
    if (Math.abs(worldPos.x - left) <= handleSize && worldPos.y >= top - handleSize && worldPos.y <= bottom + handleSize) {
      return 'w';
    }
    if (Math.abs(worldPos.x - right) <= handleSize && worldPos.y >= top - handleSize && worldPos.y <= bottom + handleSize) {
      return 'e';
    }
    if (Math.abs(worldPos.y - top) <= handleSize && worldPos.x >= left - handleSize && worldPos.x <= right + handleSize) {
      return 'n';
    }
    if (Math.abs(worldPos.y - bottom) <= handleSize && worldPos.x >= left - handleSize && worldPos.x <= right + handleSize) {
      return 's';
    }
    
    return 'none';
  }

  // Get cursor style for resize handle
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

  // Find the topmost node at a given position
  static findNodeAtPosition(
    worldPos: { x: number; y: number },
    nodes: NodeSchema[]
  ): NodeSchema | null {
    // Iterate in reverse order to check topmost nodes first
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (this.isPointInNode(worldPos, nodes[i])) {
        return nodes[i];
      }
    }
    return null;
  }

  // Calculate new node dimensions based on resize handle and mouse movement
  static calculateResize(
    handle: ResizeHandle,
    deltaX: number,
    deltaY: number,
    currentWidth: number,
    currentHeight: number,
    currentX: number,
    currentY: number,
    minWidth: number = 40,
    minHeight: number = 30
  ): { width: number; height: number; x: number; y: number } {
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    let newX = currentX;
    let newY = currentY;

    switch (handle) {
      case 'e':
        newWidth = Math.max(minWidth, currentWidth + deltaX);
        break;
      case 'w':
        newWidth = Math.max(minWidth, currentWidth - deltaX);
        if (newWidth > minWidth) {
          newX = currentX + deltaX / 2;
        }
        break;
      case 's':
        newHeight = Math.max(minHeight, currentHeight + deltaY);
        break;
      case 'n':
        newHeight = Math.max(minHeight, currentHeight - deltaY);
        if (newHeight > minHeight) {
          newY = currentY + deltaY / 2;
        }
        break;
      case 'se':
        newWidth = Math.max(minWidth, currentWidth + deltaX);
        newHeight = Math.max(minHeight, currentHeight + deltaY);
        break;
      case 'sw':
        newWidth = Math.max(minWidth, currentWidth - deltaX);
        newHeight = Math.max(minHeight, currentHeight + deltaY);
        if (newWidth > minWidth) {
          newX = currentX + deltaX / 2;
        }
        break;
      case 'ne':
        newWidth = Math.max(minWidth, currentWidth + deltaX);
        newHeight = Math.max(minHeight, currentHeight - deltaY);
        if (newHeight > minHeight) {
          newY = currentY + deltaY / 2;
        }
        break;
      case 'nw':
        newWidth = Math.max(minWidth, currentWidth - deltaX);
        newHeight = Math.max(minHeight, currentHeight - deltaY);
        if (newWidth > minWidth) {
          newX = currentX + deltaX / 2;
        }
        if (newHeight > minHeight) {
          newY = currentY + deltaY / 2;
        }
        break;
    }

    return { width: newWidth, height: newHeight, x: newX, y: newY };
  }
}