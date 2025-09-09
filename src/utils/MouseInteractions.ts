import type { NodeSchema } from "../types";

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
    const width = node.visual.width || 120;
    const height = node.visual.height || 80;
    
    const left = nodeX - width / 2;
    const right = nodeX + width / 2;
    const top = nodeY - height / 2;
    const bottom = nodeY + height / 2;
    
    return worldPos.x >= left && 
           worldPos.x <= right && 
           worldPos.y >= top && 
           worldPos.y <= bottom;
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
}