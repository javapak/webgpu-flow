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
  const shape = node.visual.shape || 'rectangle';
  
  // Handle detection threshold in world coordinates (adjusted for zoom)
  const handleSize = Math.max(12 / viewport.zoom, 8); // Minimum 8 world units
  
  console.log('🔍 Shape-aware resize handle check:', {
    nodeId: node.id,
    worldPos,
    shape,
    handleSize,
    selected: node.visual?.selected
  });
  
  // Get shape-specific handle positions using the same logic as the renderer
  const handlePositions = this.getShapeHandlePositions(nodeX, nodeY, width, height, shape);
  
  // Check each handle position
  for (const handlePos of handlePositions) {
    const distance = Math.sqrt(
      Math.pow(worldPos.x - handlePos.x, 2) + 
      Math.pow(worldPos.y - handlePos.y, 2)
    );
    
    if (distance <= handleSize) {
      // Determine handle type based on position relative to center
      const handle = this.determineHandleType(handlePos.x, handlePos.y, nodeX, nodeY, width, height, shape);
      console.log('✅ Hit handle:', handle, 'at position:', handlePos);
      return handle;
    }
  }
  
  console.log('❌ No handle hit');
  return 'none';
}

private static getShapeHandlePositions(
  centerX: number, 
  centerY: number, 
  width: number, 
  height: number, 
  shape: string
): Array<{x: number, y: number, type: 'corner' | 'edge'}> {
  const handles: Array<{x: number, y: number, type: 'corner' | 'edge'}> = [];
  
  // Simple shapes that benefit from custom handle positioning
  switch (shape) {
    case 'circle':
    case 'initialNode':
    case 'finalNode': {
      const radius = Math.max(width, height) / 2 * 0.95;
      handles.push(
        { x: centerX, y: centerY - radius, type: 'edge' },
        { x: centerX + radius, y: centerY, type: 'edge' },
        { x: centerX, y: centerY + radius, type: 'edge' },
        { x: centerX - radius, y: centerY, type: 'edge' },
        { x: centerX + radius * 0.707, y: centerY - radius * 0.707, type: 'corner' },
        { x: centerX + radius * 0.707, y: centerY + radius * 0.707, type: 'corner' },
        { x: centerX - radius * 0.707, y: centerY + radius * 0.707, type: 'corner' },
        { x: centerX - radius * 0.707, y: centerY - radius * 0.707, type: 'corner' },
      );
      return handles;
    }
    
    case 'diamond': {
      const halfWidth = width / 2 * 0.95;
      const halfHeight = height / 2 * 0.95;
      handles.push(
        { x: centerX, y: centerY - halfHeight, type: 'corner' },
        { x: centerX + halfWidth, y: centerY, type: 'corner' },
        { x: centerX, y: centerY + halfHeight, type: 'corner' },
        { x: centerX - halfWidth, y: centerY, type: 'corner' },
        { x: centerX + halfWidth * 0.5, y: centerY - halfHeight * 0.5, type: 'edge' },
        { x: centerX + halfWidth * 0.5, y: centerY + halfHeight * 0.5, type: 'edge' },
        { x: centerX - halfWidth * 0.5, y: centerY + halfHeight * 0.5, type: 'edge' },
        { x: centerX - halfWidth * 0.5, y: centerY - halfHeight * 0.5, type: 'edge' },
      );
      return handles;
    }
    
    case 'hexagon': {
      const radius = Math.max(width, height) / 2 * 0.9;
      const angles = [0, Math.PI/3, 2*Math.PI/3, Math.PI, 4*Math.PI/3, 5*Math.PI/3];
      
      angles.forEach(angle => {
        handles.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
          type: 'corner'
        });
      });
      return handles;
    }
    
    case 'oval': {
      const a = width / 2 * 0.95;
      const b = height / 2 * 0.85;
      
      handles.push(
        { x: centerX, y: centerY - b, type: 'edge' },
        { x: centerX + a, y: centerY, type: 'edge' },
        { x: centerX, y: centerY + b, type: 'edge' },
        { x: centerX - a, y: centerY, type: 'edge' },
        { x: centerX + a * 0.707, y: centerY - b * 0.707, type: 'corner' },
        { x: centerX + a * 0.707, y: centerY + b * 0.707, type: 'corner' },
        { x: centerX - a * 0.707, y: centerY + b * 0.707, type: 'corner' },
        { x: centerX - a * 0.707, y: centerY - b * 0.707, type: 'corner' },
      );
      return handles;
    }
    
    // All other shapes use reliable bounding box handles
    default: {
      const halfWidth = width / 2 * 0.95;
      const halfHeight = height / 2 * 0.95;
      
      handles.push(
        { x: centerX - halfWidth, y: centerY - halfHeight, type: 'corner' },
        { x: centerX + halfWidth, y: centerY - halfHeight, type: 'corner' },
        { x: centerX - halfWidth, y: centerY + halfHeight, type: 'corner' },
        { x: centerX + halfWidth, y: centerY + halfHeight, type: 'corner' },
        { x: centerX, y: centerY - halfHeight, type: 'edge' },
        { x: centerX, y: centerY + halfHeight, type: 'edge' },
        { x: centerX - halfWidth, y: centerY, type: 'edge' },
        { x: centerX + halfWidth, y: centerY, type: 'edge' },
      );
      return handles;
    }
  }
}

// Add helper method to determine handle type from position
private static determineHandleType(
  handleX: number, 
  handleY: number, 
  centerX: number, 
  centerY: number,
  width: number,
  height: number,
  shape: string
): ResizeHandle {
  const tolerance = 0.1; // Small tolerance for floating point comparison
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  
  // Calculate relative position
  const relX = handleX - centerX;
  const relY = handleY - centerY;
  
  // For most shapes, we can determine handle type by relative position
  if (Math.abs(relX) < tolerance) {
    // Vertical handles
    return relY < 0 ? 'n' : 's';
  } else if (Math.abs(relY) < tolerance) {
    // Horizontal handles
    return relX < 0 ? 'w' : 'e';
  } else {
    // Corner handles
    if (relX < 0 && relY < 0) return 'nw';
    if (relX > 0 && relY < 0) return 'ne';
    if (relX < 0 && relY > 0) return 'sw';
    if (relX > 0 && relY > 0) return 'se';
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