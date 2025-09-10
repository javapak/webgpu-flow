import tgpu, {type TgpuRenderPipeline, type TgpuBuffer, type TgpuBindGroup, type TgpuTexture} from 'typegpu';
import type { WebGPURenderer, DiagramState } from '../types';
import TextRenderer from './TextRenderer';


declare global {
  interface Navigator {
    gpu?: GPU;
  }
  
  interface GPU {
    getPreferredCanvasFormat(): GPUTextureFormat;
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
  }
  
  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  }
  
  interface GPUDevice {
    createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
    createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
    createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
    createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
    createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    createTexture(descriptor: any): any;
    queue: GPUQueue;
  }
  
  interface GPUQueue {
    writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: ArrayBuffer | ArrayBufferView): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }
  
  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer;
  }
  
  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    setVertexBuffer(slot: number, buffer: GPUBuffer): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
    end(): void;
  }
  
  interface GPUBuffer {
    destroy(): void;
  }
  
  interface HTMLCanvasElement {
    getContext(contextId: 'webgpu'): GPUCanvasContext | null;
  }
  
  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
    getCurrentTexture(): GPUTexture;
  }
  
  interface GPUTexture {
    createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
    destroy(): void;
  }
  
  // Type aliases and enums
  type GPUTextureFormat = string;
  type GPUShaderModule = object;
  type GPUBindGroupLayout = object;
  type GPUPipelineLayout = object;
  type GPURenderPipeline = object;
  type GPUBindGroup = object;
  type GPUCommandBuffer = object;
  type GPUTextureView = object;
  
  // Descriptor interfaces
  interface GPUCanvasConfiguration {
    device: GPUDevice;
    format: GPUTextureFormat;
    alphaMode?: 'opaque' | 'premultiplied';
  }
  
  interface GPUShaderModuleDescriptor {
    code: string;
  }
  
  interface GPUBufferDescriptor {
    size: number;
    usage: number;
  }
  
  interface GPURenderPassDescriptor {
    colorAttachments: (GPURenderPassColorAttachment | null)[];
  }
  
  interface GPURenderPassColorAttachment {
    view: GPUTextureView;
    resolveTarget?: GPUTextureView;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: 'load' | 'clear';
    storeOp: 'store' | 'discard';
  }
  
  // Other descriptor types (simplified)
  type GPURequestAdapterOptions = object;
  type GPUDeviceDescriptor = object;
  type GPUBindGroupLayoutDescriptor = object;
  type GPUPipelineLayoutDescriptor = object;
  type GPURenderPipelineDescriptor = object;
  type GPUBindGroupDescriptor = object;
  type GPUCommandEncoderDescriptor = object;
  type GPUCommandBufferDescriptor = object;
  type GPUTextureViewDescriptor = object;
}

export class WebGPUDiagramRenderer implements WebGPURenderer {
  canvas: HTMLCanvasElement | null = null;
  context: any | null = null;
  root: any | null = null;
  initialized: boolean = false;
  
  private renderPipeline: TgpuRenderPipeline | null = null;
  private textRenderer: TextRenderer | null = null;
  private textRenderPipeline: any = null;
  private textBindGroupLayout: any = null;
  private sampler: any = null;
  private textBuffers: Map<string, { buffer: any, vertexCount: number, bindGroup: TgpuBindGroup, texture: any }> = new Map();
  private lineRenderPipeline: TgpuRenderPipeline | null =  null;
  private singleVertexRenderPipeline: TgpuRenderPipeline | null = null;
  private nodeBuffer: TgpuBuffer<any> | null = null;
  private lineBuffer: TgpuBuffer<any> | null  = null;
  private singleVertexBuffer: TgpuBuffer<any> | null = null;
  private uniformBuffer: any = null;
  private bindGroup: any = null;
  private bufferUsage: any = null;
  private msaaTexture: any = null;

  async initialize(canvas: HTMLCanvasElement, dimensions: {width: number, height: number}): Promise<boolean> {
    try {
      
      if (this.initialized) {
        return true;
      }
      
      this.root = await tgpu.init();
      
      this.canvas = canvas;
      this.context = canvas.getContext('webgpu');
      
      if (!this.context) {
        console.warn('Failed to get WebGPU context');
        return false;
      }

      const presentationFormat = navigator.gpu!.getPreferredCanvasFormat();
      
      this.context.configure({
        device: this.root.device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
      });

      await this.createRenderPipeline(dimensions);
      
      this.initialized = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  private async createRenderPipeline(dimensions: {width: number, height: number}) {
    
    let GPUBufferUsage, GPUShaderStage;
    
    if (typeof window !== 'undefined' && (window as any).GPUBufferUsage) {
      GPUBufferUsage = (window as any).GPUBufferUsage;
      GPUShaderStage = (window as any).GPUShaderStage;
    } else {
      GPUBufferUsage = {
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
      };
      GPUShaderStage = {
        VERTEX: 0x1,
        FRAGMENT: 0x2,
        COMPUTE: 0x4,
      };
    }
    
    this.bufferUsage = GPUBufferUsage;

    const lineVertexShaderCode = `
    struct VertexInput {
      @location(0) position: vec2<f32>,
      @location(1) color: vec3<f32>,
    }

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec3<f32>,
    }

    @vertex
    fn main(input: VertexInput) -> VertexOutput {
      var output: VertexOutput;
      
      let clipPos = (input.position / vec2<f32>(${dimensions.width}.0, ${dimensions.height}.0)) * 2.0 - 1.0;
      
      output.position = vec4<f32>(clipPos.x, -clipPos.y, 0.0, 1.0);
      output.color = input.color;
      
      return output;
    }
`;

const singleVertexShaderCode = `
    struct VertexInput {
      @location(0) position: vec2<f32>,
      @location(1) color: vec3<f32>,
    }

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec3<f32>,
    }

    @vertex
    fn main(input: VertexInput) -> VertexOutput {
      var output: VertexOutput;
      
      let clipPos = (input.position / vec2<f32>(${dimensions.width}.0, ${dimensions.height}.0)) * 2.0 - 1.0;
      
      output.position = vec4<f32>(clipPos.x, -clipPos.y, 0.0, 1.0);
      output.color = input.color;
      
      return output;
    }
  `;
    const vertexShaderCode = `
      struct VertexInput {
        @location(0) position: vec2<f32>,
        @location(1) nodePos: vec2<f32>,
        @location(2) nodeSize: vec2<f32>,
        @location(3) color: vec3<f32>,
      }

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec3<f32>,
      }

      @vertex
      fn main(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        
        let worldPos = input.nodePos + input.position * input.nodeSize;
        let clipPos = (worldPos / vec2<f32>(${dimensions.width}.0, ${dimensions.height}.0)) * 2.0 - 1.0;
        
        output.position = vec4<f32>(clipPos.x, -clipPos.y, 0.0, 1.0);
        output.color = input.color;
        
        return output;
      }
    `;

    const fragmentShaderCode = `
      struct FragmentInput {
        @location(0) color: vec3<f32>,
      }

      @fragment
      fn main(input: FragmentInput) -> @location(0) vec4<f32> {
        return vec4<f32>(input.color, 1.0);
      }
    `;

    const device = this.root.device;

    this.textRenderer = new TextRenderer(device);

      this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    const textVertexShader = `
      struct VertexInput {
        @location(0) position: vec2<f32>,
        @location(1) texCoord: vec2<f32>,
      }

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) texCoord: vec2<f32>,
      }

      @vertex
      fn main(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        
        let clipPos = (input.position / vec2<f32>(${dimensions.width}.0, ${dimensions.height}.0)) * 2.0 - 1.0;
        output.position = vec4<f32>(clipPos.x, -clipPos.y, 0.0, 1.0);
        output.texCoord = input.texCoord;
        
        return output;
      }
    `;

    const textFragmentShader = `
      @group(0) @binding(0) var textSampler: sampler;
      @group(0) @binding(1) var textTexture: texture_2d<f32>;

      @fragment
      fn main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
        let color = textureSample(textTexture, textSampler, texCoord);
        // Discard transparent pixels
        if (color.a < 0.1) {
          discard;
        }
        return color;
      }
    `;

    const textVertShader = device.createShaderModule({ code: textVertexShader });
    const textFragShader = device.createShaderModule({ code: textFragmentShader });

    // Create bind group layout for text rendering
    this.textBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        },
      ],
    });

    this.textRenderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.textBindGroupLayout],
      }),
      vertex: {
        module: textVertShader,
        entryPoint: 'main',
        buffers: [{
          arrayStride: 16, // 4 floats * 4 bytes = 16 bytes
          attributes: [
            { format: 'float32x2', offset: 0, shaderLocation: 0 }, // position
            { format: 'float32x2', offset: 8, shaderLocation: 1 }, // texCoord
          ],
        }],
      },
      fragment: {
        module: textFragShader,
        entryPoint: 'main',
        targets: [{
          format: navigator.gpu!.getPreferredCanvasFormat(),
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-list',
      },
      multisample: {
        count: 4,
      },
    });
    
    const vertexShader = device.createShaderModule({
      code: vertexShaderCode,
    });

    const lineVertexShader = device.createShaderModule({
        code: lineVertexShaderCode,
    })

    const singleVertexShader = device.createShaderModule({code: singleVertexShaderCode});

    const fragmentShader = device.createShaderModule({
      code: fragmentShaderCode,
    });

    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });


    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { 
          type: 'uniform',
          hasDynamicOffset: false,
          minBindingSize: 0
        }
      }]
    });

    this.lineRenderPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: {
            module: lineVertexShader,
            entryPoint: 'main',
            buffers: [{
            arrayStride: 20,
            attributes: [
                { format: 'float32x2', offset: 0, shaderLocation: 0 },
                { format: 'float32x3', offset: 8, shaderLocation: 1 },
            ]
            }]
        },
      fragment: {
        module: fragmentShader,
        entryPoint: 'main',
        targets: [{
          format: navigator.gpu!.getPreferredCanvasFormat(),
        }]
      },
      primitive: {
        topology: 'line-strip',
      },
      multisample: {
        count: 4,
      }


    })

    this.singleVertexRenderPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: {
            module: singleVertexShader,
            entryPoint: 'main',
            buffers: [{
            arrayStride: 20,
            attributes: [
                { format: 'float32x2', offset: 0, shaderLocation: 0 },
                { format: 'float32x3', offset: 8, shaderLocation: 1 },
            ]
            }]
        },
      fragment: {
        module: fragmentShader,
        entryPoint: 'main',
        targets: [{
          format: navigator.gpu!.getPreferredCanvasFormat(),
        }]
      },
      primitive: {
        topology: 'point-list',
      },
      multisample: {
        count: 4,
      }


    })



    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: vertexShader,
        entryPoint: 'main',
        buffers: [{
          arrayStride: 36,
          attributes: [
            { format: 'float32x2', offset: 0, shaderLocation: 0 },
            { format: 'float32x2', offset: 8, shaderLocation: 1 },
            { format: 'float32x2', offset: 16, shaderLocation: 2 },
            { format: 'float32x3', offset: 24, shaderLocation: 3 },
          ]
        }]
      },
      fragment: {
        module: fragmentShader,
        entryPoint: 'main',
        targets: [{
          format: navigator.gpu!.getPreferredCanvasFormat(),
        }]
      },
      primitive: {
        topology: 'triangle-list',
      },
      multisample: {
        count: 4,
      }
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer }
      }]
    });

    this.createMSAATexture();
  }

  private createMSAATexture() {
    const device = this.root.device;
    const canvas = this.canvas!;
    
    this.msaaTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount: 4,
      format: navigator.gpu!.getPreferredCanvasFormat(),
      usage: 0x10, // RENDER_ATTACHMENT
    });
  }

  private updateNodeBuffer(state: DiagramState) {
    const device = this.root.device;
    const vertices: number[] = [];
    const selectionBoxVertices: number[] = []
    const resizeHandleVertices: number[] = [];

    
    state.nodes.forEach((node, index) => {
        let x = node.data.position?.x || 0;
        let y = node.data.position?.y || 0;
        x = (x - state.viewport.x) * state.viewport.zoom;
        y = (y - state.viewport.y) * state.viewport.zoom;
        let width = node.visual.width || 120 ;
        let height = node.visual.height || 80;
        width *= state.viewport.zoom;
        height *= state.viewport.zoom;
        const shape = node.visual.shape || 'rectangle';


        
        const color = this.hexToRgb(node.visual.color || '#3b82f6');
        if (node.visual.selected) {
            const selectionBox = this.generateSelectionBoxVertices(x, y, width, height, color);
            const handles = this.generateResizeHandleVertices(x, y, width, height);
            selectionBoxVertices.push(...selectionBox);
            resizeHandleVertices.push(...handles);
        }
        const shapeVertices = this.generateShapeVertices(shape, x, y, width, height, color);
        vertices.push(...shapeVertices);
    });

    if (this.nodeBuffer) {
        this.nodeBuffer.destroy();
    }

    if (this.lineBuffer) {
        this.lineBuffer.destroy();
    }

    if (vertices.length > 0) {
        this.nodeBuffer = device.createBuffer({
        size: vertices.length * 4,
        usage: this.bufferUsage.VERTEX | this.bufferUsage.COPY_DST,
    });

      device.queue.writeBuffer(this.nodeBuffer, 0, new Float32Array(vertices));
    }

    if (selectionBoxVertices.length > 0) {
        this.lineBuffer = device.createBuffer({
            size: vertices.length * 4,
            usage: this.bufferUsage.VERTEX | this.bufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.lineBuffer, 0, new Float32Array(selectionBoxVertices));
    }

      if (resizeHandleVertices.length > 0) {
      this.singleVertexBuffer = device.createBuffer({
          size: resizeHandleVertices.length * 4,
          usage: this.bufferUsage.VERTEX | this.bufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(this.singleVertexBuffer, 0, new Float32Array(resizeHandleVertices));
  }
  }

  private generateRoundedRectangleVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  const vertices: number[] = [];
  const cornerRadius = 0.1; // 10% of size for corner rounding
  const segments = 8; // Segments per corner
  
  // Generate rounded corners using triangles
  // This creates a rectangle with rounded corners by making small triangular segments at each corner
  
  // Main rectangle (center area)
  const innerLeft = -0.5 + cornerRadius;
  const innerRight = 0.5 - cornerRadius;
  const innerTop = 0.5 - cornerRadius;
  const innerBottom = -0.5 + cornerRadius;
  
  // Center rectangle
  vertices.push(
    innerLeft, innerBottom, x, y, width, height, ...color,
    innerRight, innerBottom, x, y, width, height, ...color,
    innerLeft, innerTop, x, y, width, height, ...color,
    
    innerRight, innerBottom, x, y, width, height, ...color,
    innerRight, innerTop, x, y, width, height, ...color,
    innerLeft, innerTop, x, y, width, height, ...color,
  );
  
  // Top and bottom rectangles
  vertices.push(
    -0.5, innerBottom, x, y, width, height, ...color,
    0.5, innerBottom, x, y, width, height, ...color,
    -0.5, -0.5, x, y, width, height, ...color,
    
    0.5, innerBottom, x, y, width, height, ...color,
    0.5, -0.5, x, y, width, height, ...color,
    -0.5, -0.5, x, y, width, height, ...color,
    
    -0.5, 0.5, x, y, width, height, ...color,
    0.5, 0.5, x, y, width, height, ...color,
    -0.5, innerTop, x, y, width, height, ...color,
    
    0.5, 0.5, x, y, width, height, ...color,
    0.5, innerTop, x, y, width, height, ...color,
    -0.5, innerTop, x, y, width, height, ...color,
  );
  
  // Left and right rectangles
  vertices.push(
    innerLeft, -0.5, x, y, width, height, ...color,
    -0.5, -0.5, x, y, width, height, ...color,
    innerLeft, 0.5, x, y, width, height, ...color,
    
    -0.5, -0.5, x, y, width, height, ...color,
    -0.5, 0.5, x, y, width, height, ...color,
    innerLeft, 0.5, x, y, width, height, ...color,
    
    0.5, -0.5, x, y, width, height, ...color,
    innerRight, -0.5, x, y, width, height, ...color,
    0.5, 0.5, x, y, width, height, ...color,
    
    innerRight, -0.5, x, y, width, height, ...color,
    innerRight, 0.5, x, y, width, height, ...color,
    0.5, 0.5, x, y, width, height, ...color,
  );
  
  return vertices;
}

private generateOvalVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  const vertices: number[] = [];
  const segments = 32;
  
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;
    
    // Create ellipse by scaling x and y differently
    vertices.push(
      // Center
      0, 0, x, y, width, height, ...color,
      // First edge point
      Math.cos(angle1) * 0.5, Math.sin(angle1) * 0.3, x, y, width, height, ...color,
      // Second edge point  
      Math.cos(angle2) * 0.5, Math.sin(angle2) * 0.3, x, y, width, height, ...color,
    );
  }
  
  return vertices;
}

private generateHexagonVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  const vertices: number[] = [];
  

  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    points.push([Math.cos(angle) * 0.5, Math.sin(angle) * 0.5]);
  }

  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    vertices.push(
      // Center
      0, 0, x, y, width, height, ...color,
      // Current point
      points[i][0], points[i][1], x, y, width, height, ...color,
      // Next point
      points[next][0], points[next][1], x, y, width, height, ...color,
    );
  }
  
  return vertices;
}

private generateActorVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  const vertices: number[] = [];
  const headY = -0.25; 
  const headRadius = 0.1;
  for (let i = 0; i < 8; i++) {
    const angle1 = (i / 8) * Math.PI * 2;
    const angle2 = ((i + 1) / 8) * Math.PI * 2;
    
    vertices.push(
      0, headY, x, y, width, height, ...color,
      Math.cos(angle1) * headRadius, headY + Math.sin(angle1) * headRadius, x, y, width, height, ...color,
      Math.cos(angle2) * headRadius, headY + Math.sin(angle2) * headRadius, x, y, width, height, ...color,
    );
  }
  
  // Body (flipped Y)
  vertices.push(
    -0.05, headY + headRadius, x, y, width, height, ...color,
    0.05, headY + headRadius, x, y, width, height, ...color,
    -0.05, 0.1, x, y, width, height, ...color,
    
    0.05, headY + headRadius, x, y, width, height, ...color,
    0.05, 0.1, x, y, width, height, ...color,
    -0.05, 0.1, x, y, width, height, ...color,
  );
  
  // Arms (flipped Y)
  vertices.push(
    -0.2, -0.05, x, y, width, height, ...color,
    0.2, -0.05, x, y, width, height, ...color,
    -0.2, 0.0, x, y, width, height, ...color,
    
    0.2, -0.05, x, y, width, height, ...color,
    0.2, 0.0, x, y, width, height, ...color,
    -0.2, 0.0, x, y, width, height, ...color,
  );
  
  // Legs (flipped Y)
  vertices.push(
    -0.05, 0.1, x, y, width, height, ...color,
    -0.15, 0.4, x, y, width, height, ...color,
    0.0, 0.1, x, y, width, height, ...color,
    
    0.0, 0.1, x, y, width, height, ...color,
    0.15, 0.4, x, y, width, height, ...color,
    0.05, 0.1, x, y, width, height, ...color,
  );
  
  return vertices;
}
private generatePackageVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  const vertices: number[] = [];
  
  // Package shape - rectangle with tab (Y coordinates flipped)
  const tabWidth = 0.3;
  const tabHeight = 0.1;
  
  // Main rectangle (flipped Y)
  vertices.push(
    -0.5, 0.5, x, y, width, height, ...color,
    0.5, 0.5, x, y, width, height, ...color,
    -0.5, -0.5 + tabHeight, x, y, width, height, ...color,
    
    0.5, 0.5, x, y, width, height, ...color,
    0.5, -0.5 + tabHeight, x, y, width, height, ...color,
    -0.5, -0.5 + tabHeight, x, y, width, height, ...color,
  );
  
  // Tab (flipped Y)
  vertices.push(
    -0.5, -0.5 + tabHeight, x, y, width, height, ...color,
    -0.5 + tabWidth, -0.5 + tabHeight, x, y, width, height, ...color,
    -0.5, -0.5, x, y, width, height, ...color,
    
    -0.5 + tabWidth, -0.5 + tabHeight, x, y, width, height, ...color,
    -0.5 + tabWidth, -0.5, x, y, width, height, ...color,
    -0.5, -0.5, x, y, width, height, ...color,
  );
  
  return vertices;
}

private generateInitialNodeVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  // Filled circle for initial state
  const vertices: number[] = [];
  const segments = 16;
  
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;
    
    vertices.push(
      0, 0, x, y, width, height, ...color,
      Math.cos(angle1) * 0.3, Math.sin(angle1) * 0.3, x, y, width, height, ...color,
      Math.cos(angle2) * 0.3, Math.sin(angle2) * 0.3, x, y, width, height, ...color,
    );
  }
  
  return vertices;
}

private generateFinalNodeVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  // Bulls-eye: outer circle with inner filled circle
  const vertices: number[] = [];
  const segments = 16;
  
  // Outer ring
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;
    
    // Outer edge
    const outerX1 = Math.cos(angle1) * 0.4;
    const outerY1 = Math.sin(angle1) * 0.4;
    const outerX2 = Math.cos(angle2) * 0.4;
    const outerY2 = Math.sin(angle2) * 0.4;
    
    // Inner edge  
    const innerX1 = Math.cos(angle1) * 0.2;
    const innerY1 = Math.sin(angle1) * 0.2;
    const innerX2 = Math.cos(angle2) * 0.2;
    const innerY2 = Math.sin(angle2) * 0.2;
    
    // Ring segment (2 triangles)
    vertices.push(
      outerX1, outerY1, x, y, width, height, ...color,
      innerX1, innerY1, x, y, width, height, ...color,
      outerX2, outerY2, x, y, width, height, ...color,
      
      innerX1, innerY1, x, y, width, height, ...color,
      innerX2, innerY2, x, y, width, height, ...color,
      outerX2, outerY2, x, y, width, height, ...color,
    );
  }
  
  // Inner filled circle
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;
    
    vertices.push(
      0, 0, x, y, width, height, ...color,
      Math.cos(angle1) * 0.15, Math.sin(angle1) * 0.15, x, y, width, height, ...color,
      Math.cos(angle2) * 0.15, Math.sin(angle2) * 0.15, x, y, width, height, ...color,
    );
  }
  
  return vertices;

}

private generateResizeHandleVertices(x: number, y: number, width: number, height: number): number[] {
  const vertices: number[] = [];
  
  // Calculate handle positions (8 handles: 4 corners + 4 edge midpoints)
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = y - height / 2;
  const top = y + height / 2;
  const centerX = x;
  const centerY = y;
  
  // Handle color (usually white or a contrasting color)
  const handleColor = [1.0, 1.0, 1.0]; // White handles
  
  // Corner handles
  vertices.push(left, top, ...handleColor);   
  vertices.push(left + 1, top, ...handleColor);
  vertices.push(left - 1, top, ...handleColor);
  vertices.push(left, top + 1, ...handleColor);
  vertices.push(left, top - 1, ...handleColor);
  vertices.push(left + 2, top -1, ...handleColor);
  vertices.push(left - 2, top - 1, ...handleColor);
  vertices.push(left + 2, top + 1, ...handleColor);
  vertices.push(left - 2, top + 1, ...handleColor);      // Top-left (nw)

  vertices.push(right, top, ...handleColor);   
  vertices.push(right + 1, top, ...handleColor);
  vertices.push(right - 1, top, ...handleColor);
  vertices.push(right, top + 1, ...handleColor);
  vertices.push(right, top - 1, ...handleColor);
  vertices.push(right + 2, top -1, ...handleColor);
  vertices.push(right - 2, top - 1, ...handleColor);
  vertices.push(right + 2, top + 1, ...handleColor);
  vertices.push(right - 2, top + 1, ...handleColor); // Top-right (ne)

  vertices.push(left, bottom, ...handleColor);   
  vertices.push(left + 1, bottom, ...handleColor);
  vertices.push(left - 1, bottom, ...handleColor);
  vertices.push(left, bottom + 1, ...handleColor);
  vertices.push(left, bottom - 1, ...handleColor);
  vertices.push(left + 2, bottom -1, ...handleColor);
  vertices.push(left - 2, bottom - 1, ...handleColor);
  vertices.push(left + 2, bottom + 1, ...handleColor);
  vertices.push(left - 2, bottom + 1, ...handleColor);  // Bottom-left (sw)

  vertices.push(right, bottom, ...handleColor);   
  vertices.push(right + 1, bottom, ...handleColor);
  vertices.push(right - 1, bottom, ...handleColor);
  vertices.push(right, bottom + 1, ...handleColor);
  vertices.push(right, bottom - 1, ...handleColor);
  vertices.push(right + 2, bottom -1, ...handleColor);
  vertices.push(right - 2, bottom - 1, ...handleColor);
  vertices.push(right + 2, bottom + 1, ...handleColor);
  vertices.push(right - 2, bottom + 1, ...handleColor); // Bottom-right (se)
  
  // Edge midpoint handles
  vertices.push(centerX, top, ...handleColor);   
  vertices.push(centerX + 1, top, ...handleColor);
  vertices.push(centerX - 1, top, ...handleColor);
  vertices.push(centerX, top + 1, ...handleColor);
  vertices.push(centerX, top - 1, ...handleColor);
  vertices.push(centerX + 2, top -1, ...handleColor);
  vertices.push(centerX - 2, top - 1, ...handleColor);
  vertices.push(centerX + 2, top + 1, ...handleColor);
  vertices.push(centerX - 2, top + 1, ...handleColor);


  vertices.push(centerX, bottom, ...handleColor);   
  vertices.push(centerX + 1, bottom, ...handleColor);
  vertices.push(centerX - 1, bottom, ...handleColor);
  vertices.push(centerX, bottom + 1, ...handleColor);
  vertices.push(centerX, bottom - 1, ...handleColor);
  vertices.push(centerX + 2, bottom -1, ...handleColor);
  vertices.push(centerX - 2, bottom - 1, ...handleColor);
  vertices.push(centerX + 2, bottom + 1, ...handleColor);
  vertices.push(centerX - 2, bottom + 1, ...handleColor);// Bottom center 

  vertices.push(left, centerY, ...handleColor);   
  vertices.push(left + 1, centerY, ...handleColor);
  vertices.push(left - 1, centerY, ...handleColor);
  vertices.push(left, centerY + 1, ...handleColor);
  vertices.push(left, centerY - 1, ...handleColor);
  vertices.push(left + 2, centerY -1, ...handleColor);
  vertices.push(left - 2, centerY - 1, ...handleColor);
  vertices.push(left + 2, centerY + 1, ...handleColor);
  vertices.push(left - 2, centerY + 1, ...handleColor);// Left center (w)

  vertices.push(right, centerY, ...handleColor);   
  vertices.push(right + 1, centerY, ...handleColor);
  vertices.push(right - 1, centerY, ...handleColor);
  vertices.push(right, centerY + 1, ...handleColor);
  vertices.push(right, centerY - 1, ...handleColor);
  vertices.push(right + 2, centerY -1, ...handleColor);
  vertices.push(right - 2, centerY - 1, ...handleColor);
  vertices.push(right + 2, centerY + 1, ...handleColor);
  vertices.push(right - 2, centerY + 1, ...handleColor);  // Right center (e)
  
  return vertices;
}


  private generateShapeVertices(shape: string, x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
  switch (shape) {
    case 'circle':
      return this.generateCircleVertices(x, y, width, height, color);
    case 'diamond':
      return this.generateDiamondVertices(x, y, width, height, color);
    case 'roundedRectangle':
      return this.generateRoundedRectangleVertices(x, y, width, height, color);
    case 'oval':
      return this.generateOvalVertices(x, y, width, height, color);
    case 'hexagon':
      return this.generateHexagonVertices(x, y, width, height, color);
    case 'actor':
      return this.generateActorVertices(x, y, width, height, color);
    case 'package':
      return this.generatePackageVertices(x, y, width, height, color);
    case 'initialNode':
      return this.generateInitialNodeVertices(x, y, width, height, color);
    case 'finalNode':
      return this.generateFinalNodeVertices(x, y, width, height, color);
    case 'rectangle':
    default:
      return this.generateRectangleVertices(x, y, width, height, color);
  }
}

private generateSelectionBoxVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
    const left = x - width / 2;
    const right = x + width / 2;
    const bottom = y - height / 2;
    const top = y + height / 2;
    
    // Normalize color to 0-1 range for WebGL
    const normalizedColor = [1, 0, 0];
    
    return [
        left, bottom, ...normalizedColor,
        right, bottom, ...normalizedColor,
        right, top, ...normalizedColor,
        left, top, ...normalizedColor,
        left, bottom, ...normalizedColor, // Close the loop for line-strip
    ];
}
  private generateRectangleVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
    return [
      -0.5, -0.5, x, y, width, height, ...color,
      0.5, -0.5, x, y, width, height, ...color,
      -0.5, 0.5, x, y, width, height, ...color,
      0.5, -0.5, x, y, width, height, ...color,
      0.5, 0.5, x, y, width, height, ...color,
      -0.5, 0.5, x, y, width, height, ...color,
    ];
  }



  private generateDiamondVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
    return [
      0, 0.5, x, y, width, height, ...color,
      -0.5, 0, x, y, width, height, ...color,
      0.5, 0, x, y, width, height, ...color,
      0.5, 0, x, y, width, height, ...color,
      0, -0.5, x, y, width, height, ...color,
      0, 0.5, x, y, width, height, ...color,
      0, -0.5, x, y, width, height, ...color,
      0.5, 0, x, y, width, height, ...color,
      -0.5, 0, x, y, width, height, ...color,
      -0.5, 0, x, y, width, height, ...color,
      0, 0.5, x, y, width, height, ...color,
      0, -0.5, x, y, width, height, ...color,
    ];
  }

  private generateCircleVertices(x: number, y: number, width: number, height: number, color: [number, number, number]): number[] {
    const vertices: number[] = [];
    const segments = 32;
    
    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      
      vertices.push(
        0, 0, x, y, width, height, ...color,
        Math.cos(angle1) * 0.5, Math.sin(angle1) * 0.5, x, y, width, height, ...color,
        Math.cos(angle2) * 0.5, Math.sin(angle2) * 0.5, x, y, width, height, ...color,
      );
    }
    
    return vertices;
  }

  private hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ] : [0.2, 0.5, 0.8];
  }

  private updateTextBuffers(state: DiagramState) {
    if (!this.textRenderer) return;

    const device = this.root.device;
    
    // Clear existing text buffers
    this.textBuffers.forEach(({ buffer }) => buffer.destroy());
    this.textBuffers.clear();

    state.nodes.forEach(node => {
      if (!node.data.label) return;

      const x = node.data.position?.x || 0;
      const y = node.data.position?.y || 0;
      const screenX = (x - state.viewport.x) * state.viewport.zoom;
      const screenY = (y - state.viewport.y) * state.viewport.zoom;

      // Create text texture
      const fontSize = Math.max(12, 16 * state.viewport.zoom);
      const { texture, width, height } = this.textRenderer!.createTextTexture(
        node.data.label, 
        fontSize, 
        node.visual.textColor || '#000'
      );

      // Create quad vertices for the text
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      
      const vertices = new Float32Array([
        // Triangle 1
        screenX - halfWidth, screenY - halfHeight, 0.0, 0.0, // top-left
        screenX + halfWidth, screenY - halfHeight, 1.0, 0.0, // top-right
        screenX - halfWidth, screenY + halfHeight, 0.0, 1.0, // bottom-left
        
        // Triangle 2
        screenX + halfWidth, screenY - halfHeight, 1.0, 0.0, // top-right
        screenX + halfWidth, screenY + halfHeight, 1.0, 1.0, // bottom-right
        screenX - halfWidth, screenY + halfHeight, 0.0, 1.0, // bottom-left
      ]);

      // Create buffer
      const buffer = device.createBuffer({
        size: vertices.byteLength,
        usage: this.bufferUsage.VERTEX | this.bufferUsage.COPY_DST,
      });

      device.queue.writeBuffer(buffer, 0, vertices);

      // Create bind group for this text
      const bindGroup = device.createBindGroup({
        layout: this.textBindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: texture.createView() },
        ],
      });

      this.textBuffers.set(node.id, { 
        buffer, 
        vertexCount: 6, 
        bindGroup,
        texture 
      });
    });
  }

  private updateUniforms(state: DiagramState) {
    const device = this.root.device;
    const canvas = this.canvas!;
    
    const zoom = state.viewport.zoom;
    const tx = -state.viewport.x;
    const ty = -state.viewport.y;
    
    const viewMatrix = new Float32Array([
      zoom, 0, 0,
      0, zoom, 0,
      tx * zoom, ty * zoom, 1,
      0, 0, 0, 0, 0, 0, 0
    ]);
    
    const canvasSize = new Float32Array([canvas.width, canvas.height]);
    
    device.queue.writeBuffer(this.uniformBuffer, 0, viewMatrix);
    device.queue.writeBuffer(this.uniformBuffer, 36, canvasSize);
  }

  async render(state: DiagramState): Promise<void> {
    if (!this.initialized || !this.root || !this.context || !this.renderPipeline) {
      return;
    }


    this.updateNodeBuffer(state);
    this.updateTextBuffers(state);

    this.updateUniforms(state);
    let totalVertices = 0;
    let totalSelectionVertices = 0;
    let totalSelectionHandleVertices = 0;
    state.nodes.forEach(node => {
        if (node.visual.selected) {
          totalSelectionVertices += 5;
          totalSelectionHandleVertices += 72;
        }

        const shape = node.visual.shape || 'rectangle';
        switch (shape) {
        case 'circle': totalVertices += 96; break;
        case 'oval': totalVertices += 96; break; 
        case 'diamond': totalVertices += 12; break;
        case 'roundedRectangle': totalVertices += 30; break; 
        case 'hexagon': totalVertices += 18; break;
        case 'actor': totalVertices += 42; break;  
        case 'package': totalVertices += 12; break;
        case 'initialNode': totalVertices += 48; break;
        case 'finalNode': totalVertices += 144; break;
        case 'rectangle': 
        default: totalVertices += 6; break;
        }
    });


    const device = this.root.device;
    
    try {
      const commandEncoder = device.createCommandEncoder();
      const textureView = this.context.getCurrentTexture().createView();
      const msaaView = this.msaaTexture.createView();

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: msaaView,
          resolveTarget: textureView,
          clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      if (this.nodeBuffer && state.nodes.length > 0) {
        
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.bindGroup);
        renderPass.setVertexBuffer(0, this.nodeBuffer);
        renderPass.draw(totalVertices);
        if (this.lineBuffer && totalSelectionVertices > 0) {
            renderPass.setPipeline(this.lineRenderPipeline);
            renderPass.setVertexBuffer(0, this.lineBuffer);
            renderPass.draw(totalSelectionVertices);
        }
        if (this.singleVertexBuffer && totalSelectionHandleVertices > 0) {
            renderPass.setPipeline(this.singleVertexRenderPipeline)
            renderPass.setVertexBuffer(0, this.singleVertexBuffer);
            renderPass.draw(totalSelectionHandleVertices);
        }
        if (this.textRenderPipeline && this.textBuffers.size > 0) {
          renderPass.setPipeline(this.textRenderPipeline);
          
          this.textBuffers.forEach(({ buffer, vertexCount, bindGroup }) => {
            renderPass.setBindGroup(0, bindGroup);
            renderPass.setVertexBuffer(0, buffer);
            renderPass.draw(vertexCount);
        });
      }

      } 
      else {
      }

      renderPass.end();
      device.queue.submit([commandEncoder.finish()]);
      
    } catch (error) {
      console.error('Render error:', error);
    }
  }

  cleanup(): void {
    if (this.nodeBuffer) {
      this.nodeBuffer.destroy();
    }

    if (this.lineBuffer) {
        this.lineBuffer.destroy();
    }

    if (this.singleVertexBuffer) {
      this.singleVertexBuffer.destroy();
    }

    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
    }
    if (this.msaaTexture) {
      this.msaaTexture.destroy();
    }
    if (this.root) {
      this.root.destroy();
    }
    this.context = null;
    this.canvas = null;
    this.root = null;
    this.renderPipeline = null;
    this.lineRenderPipeline = null;
    this.singleVertexRenderPipeline = null;
    this.nodeBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.bufferUsage = null;
    this.msaaTexture = null;
    this.initialized = false;
  }
}