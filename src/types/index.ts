// index.ts - Main library exports with spatial indexing

import type { SHAPE_TYPES } from '../renderers/WebGPURenderer';
import type { ResizeHandle } from '../utils/MouseInteractions';
import type { Point, AABB } from './spatial-indexing/types';

export const GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as const;

export const GPUTextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
} as const;

export const GPUShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
} as const;

export const GPUColorWrite = {
  RED: 0x1,
  GREEN: 0x2,
  BLUE: 0x4,
  ALPHA: 0x8,
  ALL: 0xF,
} as const;


// Diagram types
export interface DiagramNode {
  id: string;
  type: string;
  data: {
    position: { x: number; y: number };
    size?: { width: number; height: number };
    label?: string;
    [key: string]: any;
  };
  visual?: {
    color?: string;
    shape?: string;
    visualContent?: {type: 'svg' | 'image' | 'emoji', content: string, size: {width: number, height: number}}
    selected?: boolean;
    [key: string]: any;
  };
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  data?: {
    label?: string;
    [key: string]: any;
  };
  visual?: {
    color?: string;
    style?: 'solid' | 'dashed' | 'dotted';
    [key: string]: any;
  };
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface InteractionState {
  selectedNodes: DiagramNode[];
  selectedEdges: DiagramEdge[];
  dragState: {
    isDragging: boolean;
    dragType: 'node' | 'viewport' | 'resize' | null;
    startPos: Point | null;
    lastPos: Point | null;
    // Resize-specific properties
    resizeHandle?: ResizeHandle;
    originalSize?: { width: number; height: number };
    originalPosition?: { x: number; y: number };
  };
  mode: 'select' | 'pan' | 'connect' | 'edit';
}

export interface DiagramState {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: Viewport;
  interaction: InteractionState;
}

// Hook exports
export {
  useSpatialIndex as useDiagram,
  type SpatialDiagramHook,

} from '../hooks/useSpatialIndex';

// WebGPU renderer exports
export {
  WebGPURenderer,
} from '../renderers/WebGPURenderer';

// Canvas 2D fallback renderer
export interface Canvas2DRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<boolean>;
  render(
    visibleNodes: DiagramNode[],
    visibleEdges: DiagramEdge[],
    viewport: Viewport,
    canvasSize: { width: number; height: number }
  ): void;
  destroy(): void;
}

export class Canvas2DDiagramRenderer implements Canvas2DRenderer {
  private context: CanvasRenderingContext2D | null = null;

  async initialize(canvas: HTMLCanvasElement): Promise<boolean> {
    this.context = canvas.getContext('2d');
    return this.context !== null;
  }

  render(
    visibleNodes: DiagramNode[],
    visibleEdges: DiagramEdge[],
    viewport: Viewport,
    canvasSize: { width: number; height: number }
  ): void {
    if (!this.context) return;

    const ctx = this.context;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    
    // Set up viewport transformation
    ctx.save();
    ctx.translate(canvasSize.width / 2, canvasSize.height / 2);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-viewport.x, -viewport.y);

    // Draw edges first (behind nodes)
    visibleEdges.forEach(edge => this.drawEdge(ctx, edge, visibleNodes));
    
    // Draw nodes
    visibleNodes.forEach(node => this.drawNode(ctx, node));

    ctx.restore();
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: DiagramNode): void {
    const { x, y } = node.data.position;
    const size = node.data.size || { width: 100, height: 60 };
    const color = node.visual?.color || '#3b82f6';
    const isSelected = node.visual?.selected || false;
    
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
  }

  private drawEdge(ctx: CanvasRenderingContext2D, edge: DiagramEdge, nodes: DiagramNode[]): void {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    
    if (!sourceNode || !targetNode) return;
    
    const color = edge.visual?.color || '#6b7280';
    const style = edge.visual?.style || 'solid';
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    if (style === 'dashed') {
      ctx.setLineDash([5, 5]);
    } else if (style === 'dotted') {
      ctx.setLineDash([2, 3]);
    }
    
    ctx.beginPath();
    ctx.moveTo(sourceNode.data.position.x, sourceNode.data.position.y);
    ctx.lineTo(targetNode.data.position.x, targetNode.data.position.y);
    ctx.stroke();
    
    // Draw arrow head
    const angle = Math.atan2(
      targetNode.data.position.y - sourceNode.data.position.y,
      targetNode.data.position.x - sourceNode.data.position.x
    );
    
    const arrowLength = 10;
    const arrowAngle = Math.PI / 6;
    
    ctx.beginPath();
    ctx.moveTo(targetNode.data.position.x, targetNode.data.position.y);
    ctx.lineTo(
      targetNode.data.position.x - arrowLength * Math.cos(angle - arrowAngle),
      targetNode.data.position.y - arrowLength * Math.sin(angle - arrowAngle)
    );
    ctx.moveTo(targetNode.data.position.x, targetNode.data.position.y);
    ctx.lineTo(
      targetNode.data.position.x - arrowLength * Math.cos(angle + arrowAngle),
      targetNode.data.position.y - arrowLength * Math.sin(angle + arrowAngle)
    );
    ctx.stroke();
    
    ctx.restore();
  }

  destroy(): void {
    this.context = null;
  }
}

// Utility functions
export const createNode = (
  id: string,
  type: string,
  position: Point,
  data: Partial<DiagramNode['data']> = {},
  visual: Partial<DiagramNode['visual']> = {}
): DiagramNode => ({
  id,
  type,
  data: {
    position,
    size: { width: 100, height: 60 },
    ...data,
  },
  visual,
});

export const createEdge = (
  id: string,
  source: string,
  target: string,
  data: Partial<DiagramEdge['data']> = {},
  visual: Partial<DiagramEdge['visual']> = {}
): DiagramEdge => ({
  id,
  source,
  target,
  data,
  visual,
});

// Coordinate transformation utilities
export const createTransformUtils = (viewport: Viewport, canvasSize: { width: number; height: number }) => ({
  screenToWorld: (screenPoint: Point): Point => ({
    x: (screenPoint.x - canvasSize.width / 2) / viewport.zoom + viewport.x,
    y: (screenPoint.y - canvasSize.height / 2) / viewport.zoom + viewport.y,
  }),

  worldToScreen: (worldPoint: Point): Point => ({
    x: (worldPoint.x - viewport.x) * viewport.zoom + canvasSize.width / 2,
    y: (worldPoint.y - viewport.y) * viewport.zoom + canvasSize.height / 2,
  }),

  getViewportBounds: (): AABB => ({
    minX: viewport.x - canvasSize.width / (2 * viewport.zoom),
    minY: viewport.y - canvasSize.height / (2 * viewport.zoom),
    maxX: viewport.x + canvasSize.width / (2 * viewport.zoom),
    maxY: viewport.y + canvasSize.height / (2 * viewport.zoom),
  }),
});

// Performance monitoring utilities
export interface PerformanceMetrics {
  totalNodes: number;
  visibleNodes: number;
  renderTime: number;
  hitTestTime: number;
  spatialIndexDepth: number;
  frameRate: number;
}

export class PerformanceMonitor {
  private frameCount = 0;
  private lastFrameTime = performance.now();
  private frameRate = 60;

  updateFrame(): void {
    this.frameCount++;
    const now = performance.now();
    
    if (now - this.lastFrameTime >= 1000) {
      this.frameRate = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  getMetrics(
    totalNodes: number,
    visibleNodes: number,
    renderTime: number,
    hitTestTime: number,
    spatialIndexDepth: number
  ): PerformanceMetrics {
    return {
      totalNodes,
      visibleNodes,
      renderTime,
      hitTestTime,
      spatialIndexDepth,
      frameRate: this.frameRate,
    };
  }
}

// Layout algorithms (basic implementations)
export const layoutAlgorithms = {
  // Force-directed layout
  forceDirected: (nodes: DiagramNode[], edges: DiagramEdge[], iterations = 100) => {
    const updatedNodes = [...nodes];
    const k = Math.sqrt((800 * 600) / nodes.length);
    
    for (let iter = 0; iter < iterations; iter++) {
      // Calculate repulsive forces
      for (let i = 0; i < updatedNodes.length; i++) {
        updatedNodes[i].data.velocity = updatedNodes[i].data.velocity || { x: 0, y: 0 };
        
        for (let j = 0; j < updatedNodes.length; j++) {
          if (i !== j) {
            const dx = updatedNodes[i].data.position.x - updatedNodes[j].data.position.x;
            const dy = updatedNodes[i].data.position.y - updatedNodes[j].data.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
            const force = k * k / distance;
            
            updatedNodes[i].data.velocity.x += (dx / distance) * force;
            updatedNodes[i].data.velocity.y += (dy / distance) * force;
          }
        }
      }
      
      // Calculate attractive forces
      edges.forEach(edge => {
        const sourceNode = updatedNodes.find(n => n.id === edge.source);
        const targetNode = updatedNodes.find(n => n.id === edge.target);
        
        if (sourceNode && targetNode) {
          const dx = targetNode.data.position.x - sourceNode.data.position.x;
          const dy = targetNode.data.position.y - sourceNode.data.position.y;
          const distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const force = distance * distance / k;
          
          sourceNode.data.velocity.x += (dx / distance) * force;
          sourceNode.data.velocity.y += (dy / distance) * force;
          targetNode.data.velocity.x -= (dx / distance) * force;
          targetNode.data.velocity.y -= (dy / distance) * force;
        }
      });
      
      // Apply velocities with damping
      updatedNodes.forEach(node => {
        const velocity = node.data.velocity || { x: 0, y: 0 };
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        const maxSpeed = 10;
        
        if (speed > maxSpeed) {
          velocity.x = (velocity.x / speed) * maxSpeed;
          velocity.y = (velocity.y / speed) * maxSpeed;
        }
        
        node.data.position.x += velocity.x * 0.1;
        node.data.position.y += velocity.y * 0.1;
        
        // Apply damping
        velocity.x *= 0.9;
        velocity.y *= 0.9;
      });
    }
    
    return updatedNodes;
  },

  // Grid layout
  grid: (nodes: DiagramNode[], columns = Math.ceil(Math.sqrt(nodes.length))) => {
    const spacing = 150;
    const updatedNodes = [...nodes];
    
    updatedNodes.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      
      node.data.position = {
        x: col * spacing - (columns - 1) * spacing / 2,
        y: row * spacing - (Math.ceil(nodes.length / columns) - 1) * spacing / 2,
      };
    });
    
    return updatedNodes;
  },

  // Circular layout
  circular: (nodes: DiagramNode[], radius = 200) => {
    const updatedNodes = [...nodes];
    const angleStep = (2 * Math.PI) / nodes.length;
    
    updatedNodes.forEach((node, index) => {
      const angle = index * angleStep;
      node.data.position = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    });
    
    return updatedNodes;
  },
};

// Schema validation utilities (basic JSON schema support)
export interface NodeSchema {
  id: string;
  type: string;
  visual: {
    shape?: keyof typeof SHAPE_TYPES;
    selected?: boolean;
    color?: string;
    size?: { width: number; height: number };
  };
  data: {
    [key: string]: any;
  };
}

export interface EdgeSchema {
  id: string;
  type: string;
  source: string,
  target: string,
  sourcePort?: string,
  targetPort?: string,
  visual: {
    width?: number;
    style?: 'dotted' | 'solid';
    color?: string;
    size?: { width: number; height: number };
  };
  data: {
    [key: string]: any;
  };
}

export const validateNodeSchema = (node: DiagramNode, schema: NodeSchema): boolean => {
  try {
    // Basic validation - in a real implementation, you'd use a proper JSON schema validator
    if (node.type !== schema.type) return false;
    
    // Validate visual properties
    if (schema.visual.shape && node.visual?.shape && node.visual.shape !== schema.visual.shape) {
      return false;
    }
    
    // Add more validation logic as needed
    return true;
  } catch {
    return false;
  }
};

// Export default configuration
export const defaultConfig = {
  viewport: {
    x: 0,
    y: 0,
    zoom: 1,
    width: 800,
    height: 600,
  },
  spatialIndex: {
    maxItems: 10,
    maxDepth: 8,
    bounds: { minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 },
  },
  interaction: {
    dragThreshold: 5,
    doubleClickThreshold: 300,
    zoomSensitivity: 0.1,
  },
  rendering: {
    useWebGPU: true,
    fallbackToCanvas2D: true,
    enableDebugInfo: false,
  },
};