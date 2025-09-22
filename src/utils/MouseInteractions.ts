import type { NodeSchema } from "../types";

export type ResizeHandle = 'none' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export class MouseInteractions {
  // Convert screen coordinates to world coordinates
  static screenToWorld(
    screenX: number, 
    screenY: number, 
    canvas: HTMLCanvasElement, 
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): { x: number; y: number } {
    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;
    
    // Convert canvas coordinates to world coordinates
    // Canvas origin (0,0) is top-left, world origin is viewport center
    const screenCenterX = viewport.width / 2;
    const screenCenterY = viewport.height / 2;
    
    const worldX = (canvasX - screenCenterX) / viewport.zoom + viewport.x;
    const worldY = (canvasY - screenCenterY) / viewport.zoom + viewport.y;
    
    return { x: worldX, y: worldY };
  }

  // Convert world coordinates to screen coordinates
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
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): ResizeHandle {
    if (!node.visual?.selected) {
      console.log('❌ Node not selected, no handles');
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
    const handleSize = Math.max(12 / viewport.zoom, 8); // Minimum 8 world units
    
    console.log('🔍 Resize handle check:', {
      nodeId: node.id,
      worldPos,
      nodeBounds: { left, right, top, bottom },
      handleSize,
      selected: node.visual?.selected
    });
    
    // Check corners first (they take priority)
    if (Math.abs(worldPos.x - left) <= handleSize && Math.abs(worldPos.y - top) <= handleSize) {
      console.log('✅ Hit handle: nw');
      return 'nw';
    }
    if (Math.abs(worldPos.x - right) <= handleSize && Math.abs(worldPos.y - top) <= handleSize) {
      console.log('✅ Hit handle: ne');
      return 'ne';
    }
    if (Math.abs(worldPos.x - left) <= handleSize && Math.abs(worldPos.y - bottom) <= handleSize) {
      console.log('✅ Hit handle: sw');
      return 'sw';
    }
    if (Math.abs(worldPos.x - right) <= handleSize && Math.abs(worldPos.y - bottom) <= handleSize) {
      console.log('✅ Hit handle: se');
      return 'se';
    }
    
    // Check edges (only if shape allows free resizing)
      if (Math.abs(worldPos.x - left) <= handleSize && worldPos.y >= top - handleSize && worldPos.y <= bottom + handleSize) {
        console.log('✅ Hit handle: w');
        return 'w';
      }
      if (Math.abs(worldPos.x - right) <= handleSize && worldPos.y >= top - handleSize && worldPos.y <= bottom + handleSize) {
        console.log('✅ Hit handle: e');
        return 'e';
      }
      if (Math.abs(worldPos.y - top) <= handleSize && worldPos.x >= left - handleSize && worldPos.x <= right + handleSize) {
        console.log('✅ Hit handle: n');
        return 'n';
      }
      if (Math.abs(worldPos.y - bottom) <= handleSize && worldPos.x >= left - handleSize && worldPos.x <= right + handleSize) {
        console.log('✅ Hit handle: s');
        return 's';
      
    }
    
    console.log('❌ No handle hit');
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

  // Helper to get shape type
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

  // Calculate new node dimensions with aspect ratio locking support
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
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    let newX = currentX;
    let newY = currentY;

    if (lockAspectRatio) {
      // For aspect ratio locked shapes, maintain perfect 1:1 ratio for circles
      const originalAspectRatio = currentWidth / currentHeight;
      const isCircle = Math.abs(originalAspectRatio - 1.0) < 0.1; // Nearly square = circle
      
      switch (handle) {
        case 'se': {
          // Southeast: use the larger absolute delta for uniform scaling
          const scaleFactor = Math.max(Math.abs(deltaX), Math.abs(deltaY));
          const direction = (deltaX + deltaY) > 0 ? 1 : -1;
          
          newWidth = Math.max(minWidth, currentWidth + scaleFactor * direction);
          
          if (isCircle) {
            newHeight = newWidth; // Perfect 1:1 for circles
          } else {
            newHeight = Math.max(minHeight, newWidth / originalAspectRatio);
          }
          break;
        }
        case 'nw': {
          // Northwest: resize in opposite direction
          const scaleFactor = Math.max(Math.abs(deltaX), Math.abs(deltaY));
          const direction = (deltaX + deltaY) < 0 ? 1 : -1;
          
          newWidth = Math.max(minWidth, currentWidth + scaleFactor * direction);
          
          if (isCircle) {
            newHeight = newWidth; // Perfect 1:1 for circles
          } else {
            newHeight = Math.max(minHeight, newWidth / originalAspectRatio);
          }
          
          // Adjust position for northwest resize
          newX = currentX - (newWidth - currentWidth) / 2;
          newY = currentY - (newHeight - currentHeight) / 2;
          break;
        }
        case 'ne': {
          // Northeast: X positive, Y negative
          const scaleFactor = Math.max(Math.abs(deltaX), Math.abs(deltaY));
          const direction = (deltaX - deltaY) > 0 ? 1 : -1;
          
          newWidth = Math.max(minWidth, currentWidth + scaleFactor * direction);
          
          if (isCircle) {
            newHeight = newWidth; // Perfect 1:1 for circles
          } else {
            newHeight = Math.max(minHeight, newWidth / originalAspectRatio);
          }
          
          // Adjust Y position for northeast resize
          newY = currentY - (newHeight - currentHeight) / 2;
          break;
        }
        case 'sw': {
          // Southwest: X negative, Y positive
          const scaleFactor = Math.max(Math.abs(deltaX), Math.abs(deltaY));
          const direction = (-deltaX + deltaY) > 0 ? 1 : -1;
          
          newWidth = Math.max(minWidth, currentWidth + scaleFactor * direction);
          
          if (isCircle) {
            newHeight = newWidth; // Perfect 1:1 for circles
          } else {
            newHeight = Math.max(minHeight, newWidth / originalAspectRatio);
          }
          
          // Adjust X position for southwest resize
          newX = currentX - (newWidth - currentWidth) / 2;
          break;
        }
      }
    } else {
      // Free resizing for shapes that don't need locked aspect ratio
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
    }

    return { width: newWidth, height: newHeight, x: newX, y: newY };
  }

  // Helper method to check if a shape should lock aspect ratio
  static shouldLockAspectRatio(shape?: string): boolean {
    const shapeType = this.getShapeType(shape);
    return shapeType === 1 || shapeType === 6 || shapeType === 7; // Circle, Initial, Final
  }

  // Helper method to convert drag event coordinates to world coordinates
  static dragEventToWorld(
    event: React.DragEvent,
    canvas: HTMLCanvasElement,
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): { x: number; y: number } {
    return this.screenToWorld(event.clientX, event.clientY, canvas, viewport);
  }

  // Helper method to get mouse position relative to canvas
  static getCanvasMousePosition(
    event: MouseEvent | DragEvent,
    canvas: HTMLCanvasElement
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }
}