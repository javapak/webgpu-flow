// index.ts - Main library exports with spatial indexing

import type { MarkerType } from '../renderers/FloatingEdgeRenderer';
import type { SHAPE_TYPES } from '../renderers/WebGPURenderer';
import type { DiagramFont } from '../utils/FontLoadUtils';
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
    iconColor?: string;
    labelColor?: string;
    labelFont?: DiagramFont;
    color?: string;
    shape?: string;
    visualContent?: {type: 'svg' | 'image' | 'emoji', content: string, size: {width: number, height: number}, colorizable?: boolean}
    selected?: boolean;
    cacheKey?: string; // For caching rendered visuals
    [key: string]: any;
  };
}

export interface DiagramEdge {
  id: string,
  data?: Record<string, any>
  sourceNodeId: string;
  targetNodeId: string;
  userVertices: Array<{x: number, y: number}>; // User-defined intermediate points
  style: {
    labelColor?: string;
    color: [number, number, number, number];
    thickness: number;
    dashPattern?: number[]; // Optional dashing
    sourceMarker? : MarkerType;
    targetMarker? : MarkerType;
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
  selectedVertex: {edgeId: string; vertexIndex: number} | null;
  altKeyPressed: boolean; // True when Alt key is pressed
  dragState: {
    isDragging: boolean;
    dragType: 'node' | 'viewport' | 'resize' | 'edge-vertex' | null;
    startPos: Point | null;
    lastPos: Point | null;
    // Resize-specific properties
    resizeHandle?: ResizeHandle;
    originalSize?: { width: number; height: number };
    originalPosition?: { x: number; y: number };
    // Edge vertex drag properties
    edgeId?: string;
    vertexIndex?: number;
    originalVertexPosition?: { x: number; y: number };
  };
  mode: 'select' | 'pan' | 'connect' | 'edit';
}

export interface DiagramState {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: Viewport;
  interaction: InteractionState;
  gridSnapping: {
    enabled: boolean; // True when Alt is NOT pressed
    gridSize: number;
  };
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
        const sourceNode = updatedNodes.find(n => n.id === edge.sourceNodeId);
        const targetNode = updatedNodes.find(n => n.id === edge.targetNodeId);
        
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