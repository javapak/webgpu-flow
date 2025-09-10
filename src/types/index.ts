export type ResizeHandle = 'none' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
declare global {
  interface GPUDevice {
    createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  }

  interface GPUQueue {
    copyExternalImageToTexture(
      source: GPUImageCopyExternalImage,
      destination: GPUImageCopyTextureTagged,
      copySize: GPUExtent3D
    ): void;
  }

  interface GPUTexture {
    createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
  }

  interface GPURenderPassEncoder {
    setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: Uint32Array): void;
  }

  // Type aliases
  type GPUSampler = object;

  // Descriptor interfaces
  interface GPUSamplerDescriptor {
    addressModeU?: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
    addressModeV?: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
    addressModeW?: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
    magFilter?: 'nearest' | 'linear';
    minFilter?: 'nearest' | 'linear';
    mipmapFilter?: 'nearest' | 'linear';
    lodMinClamp?: number;
    lodMaxClamp?: number;
    compare?: GPUCompareFunction;
    maxAnisotropy?: number;
  }

  interface GPUImageCopyExternalImage {
    source: HTMLCanvasElement | HTMLVideoElement | VideoFrame | ImageBitmap | OffscreenCanvas;
    origin?: GPUOrigin2D;
    flipY?: boolean;
  }

  interface GPUImageCopyTextureTagged {
    texture: GPUTexture;
    mipLevel?: number;
    origin?: GPUOrigin3D;
    aspect?: GPUTextureAspect;
    colorSpace?: PredefinedColorSpace;
    premultipliedAlpha?: boolean;
  }

  interface GPUExtent3D {
    width: number;
    height?: number;
    depthOrArrayLayers?: number;
  }

  interface GPUOrigin2D {
    x?: number;
    y?: number;
  }

  interface GPUOrigin3D {
    x?: number;
    y?: number;
    z?: number;
  }

  // Additional constants
  const GPUTextureUsage: {
    COPY_SRC: number;
    COPY_DST: number;
    TEXTURE_BINDING: number;
    STORAGE_BINDING: number;
    RENDER_ATTACHMENT: number;
  };

  const GPUShaderStage: {
    VERTEX: number;
    FRAGMENT: number;
    COMPUTE: number;
  };

  // Enum types
  type GPUCompareFunction = 
    | 'never'
    | 'less'
    | 'equal' 
    | 'less-equal'
    | 'greater'
    | 'not-equal'
    | 'greater-equal'
    | 'always';

  type GPUTextureAspect = 'all' | 'stencil-only' | 'depth-only';
}

// TextRenderer specific types
export interface TextTextureInfo {
  texture: GPUTexture;
  width: number;
  height: number;
}

export interface TextBufferInfo {
  buffer: any; // TgpuBuffer or GPUBuffer
  vertexCount: number;
  bindGroup: GPUBindGroup;
  texture: GPUTexture;
}

export interface TextRenderOptions {
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: CanvasTextAlign;
  textBaseline?: CanvasTextBaseline;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface NodeSchema {
  id: string;
  type: string;
  visual: {
    width?: number;
    selected?: boolean;
    height?: number;
    color?: string;
    textColor?: string;
    shape?: 'rectangle' | 'circle' | 'diamond' | 'package' | 'roundedRectangle' | 'hexagon' | 'initialNode' | 'finalNode' | 'oval' | 'actor';
    ports?: Array<{
      id: string;
      position: 'top' | 'bottom' | 'left' | 'right';
      offset?: number;
    }>;
  };
  data: {
    label?: string; // Add this for node labels
    [key: string]: any;
  };
}

// TextRenderer class interface
export interface ITextRenderer {
  createTextTexture(text: string, options?: TextRenderOptions): TextTextureInfo;
  createTextTexture(text: string, fontSize?: number, color?: string): TextTextureInfo; // Overload for backwards compatibility
}
export interface InteractionState {
  mode: 'idle' | 'dragging' | 'panning' | 'resizing';
  dragTarget: string | null; // node ID being dragged
  resizeHandle: ResizeHandle;
  hoverHandle: ResizeHandle;
  lastMousePos: { x: number; y: number };
  selectedNodes: NodeSchema[];
}


export interface EdgeSchema {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  visual: {
    color?: string;
    width?: number;
    style?: 'solid' | 'dashed' | 'dotted';
  };
}

export interface DiagramState {
  nodes: NodeSchema[];
  edges: EdgeSchema[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface WebGPURenderer {
  canvas: HTMLCanvasElement | null;
  root: any | null; // TypeGPU root instance
  initialized: boolean;
  render: (state: DiagramState) => Promise<void>;
  cleanup: () => void;
}

export interface DiagramContextType {
  state: DiagramState;
  renderer: WebGPURenderer | null;
  interactionState: InteractionState;
  setInteractionState: (interactionState: InteractionState | any) => void;
  setSelectedNodes: (nodeIds: NodeSchema[]) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  resizeNode: (nodeId: string, dimensions: { width: number; height: number; x?: number; y?: number }) => void;
  updateNodes: (nodes: NodeSchema[]) => void;
  updateEdges: (edges: EdgeSchema[]) => void;
  setViewport: (viewport: Partial<DiagramState['viewport']>) => void;
  addNode: (node: NodeSchema) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: EdgeSchema) => void;
  removeEdge: (edgeId: string) => void;
}