/// <reference types="@webgpu/types" />
import type { DiagramNode, Viewport } from '../types';
import tgpu from 'typegpu'

interface NodeInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
  isSelected: number; // 0 or 1
  shapeType: number;
  padding: [number, number, number]; // padding for alignment
}

interface HandleInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
}

export class WebGPURenderer {
  private root: any = null;
  private context: GPUCanvasContext | null = null;
  private nodeRenderPipeline: GPURenderPipeline | null = null;
  private handleRenderPipeline: GPURenderPipeline | null = null;
  private gridRenderPipeline: GPURenderPipeline | null = null;
  private nodeBuffer: GPUBuffer | null = null;
  private handleBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private gridUniformBuffer: GPUBuffer | null = null;
  private nodeBindGroup: GPUBindGroup | null = null;
  private handleBindGroup: GPUBindGroup | null = null;
  private gridBindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  public initialized = false;
  private canvas: HTMLCanvasElement | null = null;

  async initialize(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      // Check WebGPU support
      if (!navigator.gpu) {
        console.warn('WebGPU not supported in this browser');
        return false;
      }

      this.canvas = canvas;
      
      // Initialize TypeGPU
      this.root = await tgpu.init();
      this.device = this.root.device;
      
      // Get WebGPU context
      this.context = canvas.getContext('webgpu') as GPUCanvasContext;
      if (!this.context) {
        console.error('Failed to get WebGPU context');
        return false;
      }

      // Configure canvas context
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device!,
        format: canvasFormat,
        alphaMode: 'premultiplied',
      });

      await this.setupRenderPipelines();
      this.initialized = true;
      console.log('Fixed WebGPU renderer initialized successfully');
      return true;

    } catch (error) {
      console.error('WebGPU initialization failed:', error);
      this.initialized = false;
      return false;
    }
  }

  private async setupRenderPipelines() {
    if (!this.device) throw new Error('Device not initialized');

    // Create buffers
    this.uniformBuffer = this.device.createBuffer({
      size: 80, // mat4x4 (64 bytes) + vec4 (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Grid uniform buffer now includes canvas size
    this.gridUniformBuffer = this.device.createBuffer({
      size: 96, // mat4x4 (64 bytes) + vec4 viewport (16 bytes) + vec4 canvas size (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.nodeBuffer = this.device.createBuffer({
      size: 1000 * 64, // Support up to 1000 nodes (16 floats * 4 bytes each = 64 bytes per node)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.handleBuffer = this.device.createBuffer({
      size: 8 * 32, // Up to 8 handles per selected node (8 floats * 4 bytes each)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Fixed WGSL shader with proper shape handling
    const nodeShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
      }

      struct NodeData {
        position: vec2<f32>,
        size: vec2<f32>,
        color: vec4<f32>,
        isSelected: f32,
        shapeType: f32,
        padding: vec3<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> nodeData: array<NodeData>;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) isSelected: f32,
        @location(3) shapeType: f32,
        @location(4) nodeSize: vec2<f32>
      }

      @vertex
      fn vs_main(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) instanceIndex: u32
      ) -> VertexOutput {
        // Quad vertices for instanced rendering
        let positions = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        
        let uvs = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
        );

        let node = nodeData[instanceIndex];
        let localPos = positions[vertexIndex];
        
        // Add selection padding if selected
        let selectionPadding = node.isSelected * 4.0;
        let adjustedSize = node.size + vec2<f32>(selectionPadding, selectionPadding);
        
        // Calculate world position
        let worldPos = node.position + localPos * adjustedSize * 0.5;
        
        var output: VertexOutput;
        // Apply view-projection matrix
        output.position = uniforms.viewProjection * vec4<f32>(worldPos, 0.0, 1.0);
        output.color = node.color;
        output.uv = uvs[vertexIndex];
        output.isSelected = node.isSelected;
        output.nodeSize = node.size;
        output.shapeType = node.shapeType;
        
        return output;
      }
      
      // Distance functions for different shapes
      fn sdRectangle(p: vec2<f32>, b: vec2<f32>) -> f32 {
        let d = abs(p) - b;
        return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
      }

      fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
        return length(p) - r;
      }

      fn sdDiamond(p: vec2<f32>, b: vec2<f32>) -> f32 {
        let q = abs(p);
        let h = b.x + b.y;
        return (q.x + q.y - h) / sqrt(2.0);
      }

      fn sdHexagon(p: vec2<f32>, r: f32) -> f32 {
        let k = vec3<f32>(-0.866025404, 0.5, 0.577350269);
        let q = abs(p);
        let qx_k1 = q.x * k.x;
        let qy_k2 = q.y * k.y;
        let dot_qk = qx_k1 + qy_k2;
        let q2 = vec2<f32>(q.x - 2.0 * min(dot_qk, 0.0) * k.x, q.y - 2.0 * min(dot_qk, 0.0) * k.y);
        let q3 = vec2<f32>(q2.x - clamp(q2.x, -k.z * r, k.z * r), q2.y - r);
        return length(q3) * sign(q3.y);
      }

      fn sdRoundedRectangle(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
        let q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
      }

      fn sdOval(p: vec2<f32>, ab: vec2<f32>) -> f32 {
        let p2 = p * p;
        let ab2 = ab * ab;
        return (p2.x / ab2.x + p2.y / ab2.y - 1.0);
      }

      fn sdActor(p: vec2<f32>) -> f32 {
        // Simplified stick figure - head (circle) + body (rectangle) - fixed Y axis
        let head = sdCircle(p + vec2<f32>(0.0, -0.4), 0.2); // Fixed Y
        let body = sdRectangle(p + vec2<f32>(0.0, 0.1), vec2<f32>(0.15, 0.4)); // Fixed Y
        return min(head, body);
      }

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let uv = input.uv * 2.0 - 1.0; // Convert to [-1, 1] range
        let aspectRatio = input.nodeSize.x / input.nodeSize.y;
        
        // For shapes that should maintain aspect ratio, use different coordinates
        let p = vec2<f32>(uv.x * aspectRatio, uv.y);
        let p_square = uv; // For shapes that should ignore aspect ratio
        
        var distance: f32;
        let shapeType = i32(input.shapeType + 0.5); // Round to nearest integer
        
        // Clean switch statement with proper aspect ratio handling
        switch (shapeType) {
          case 0: { // Rectangle - respects aspect ratio
            distance = sdRectangle(p, vec2<f32>(aspectRatio * 0.8, 0.8));
          }
          case 1: { // Circle - ignores aspect ratio to stay circular
            distance = sdCircle(p_square, 0.8);
          }
          case 2: { // Diamond - respects aspect ratio  
            distance = sdDiamond(uv, vec2<f32>(0, 1));
          }
          case 3: { // Hexagon - uses average to stay roughly hexagonal
            let avgRadius = 0.7 * sqrt(aspectRatio);
            distance = sdHexagon(p_square, avgRadius);
          }
          case 4: { // Package - respects aspect ratio (fixed Y axis)
            let mainBody = sdRoundedRectangle(p, vec2<f32>(aspectRatio * 0.7, 0.6), 0.1);
            let tab = sdRectangle(p + vec2<f32>(0.0, -0.75), vec2<f32>(aspectRatio * 0.3, 0.1)); // Fixed Y
            distance = min(mainBody, tab);
          }
          case 5: { // Rounded Rectangle - respects aspect ratio
            distance = sdRoundedRectangle(p, vec2<f32>(aspectRatio * 0.8, 0.8), 0.15);
          }
          case 6: { // Initial Node - stays circular
            distance = sdCircle(p_square, 0.7);
          }
          case 7: { // Final Node - stays circular with ring
            let outer = sdCircle(p_square, 0.8);
            let inner = sdCircle(p_square, 0.6);
            distance = max(outer, -inner); // Ring shape
          }
          case 8: { // Oval - designed for aspect ratio
            distance = sdOval(p, vec2<f32>(aspectRatio * 0.8, 0.6));
          }
          case 9: { // Actor - stays roughly proportional
            distance = sdActor(p_square);
          }
          default: { // Default to rectangle
            distance = sdRectangle(p, vec2<f32>(aspectRatio * 0.8, 0.8));
          }
        }

        // Anti-aliasing with better smoothing
        let smoothWidth = 0.02;
        let alpha = 1.0 - smoothstep(-smoothWidth, smoothWidth, distance);
        
        // Discard pixels that are completely transparent
        if (alpha < 0.01) {
          discard;
        }
        
        var finalColor = input.color;
        
        // Selection highlight
        if (input.isSelected > 0.5) {
          let selectionGlow = exp(-abs(distance) * 6.0) * 0.4;
          let selectionColor = vec4<f32>(0.2, 0.7, 1.0, 1.0);
          finalColor = mix(finalColor, selectionColor, selectionGlow);
        }
        
        // Border effect for better definition
        let borderWidth = 0.0;
        let borderDistance = abs(distance + borderWidth);
        let borderAlpha = 1.0 - smoothstep(0.0, borderWidth, borderDistance);
        let borderColor = vec4<f32>(0.1, 0.1, 0.1, 1.0);
        finalColor = mix(finalColor, borderColor, borderAlpha * 0.6);
        
        return vec4<f32>(finalColor.rgb, finalColor.a * alpha);
      }
    `;

    // Updated grid shader for dynamic canvas sizing
    const gridShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
        canvasSize: vec4<f32>, // width, height, padding, padding
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
      }

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        // Grid configuration
        let gridSize = 50.0; // Grid spacing in world units
        let lineWidth = max(1.0 / uniforms.viewport.z, 0.5); // Adaptive line width
        
        // Get actual canvas dimensions from uniform
        let canvasWidth = uniforms.canvasSize.x;
        let canvasHeight = uniforms.canvasSize.y;
        
        // Calculate visible world bounds based on current viewport and zoom
        let worldWidth = canvasWidth / uniforms.viewport.z;
        let worldHeight = canvasHeight / uniforms.viewport.z;
        let left = uniforms.viewport.x - worldWidth / 2.0;
        let right = uniforms.viewport.x + worldWidth / 2.0;
        let top = uniforms.viewport.y - worldHeight / 2.0;
        let bottom = uniforms.viewport.y + worldHeight / 2.0;
        
        // Extend bounds slightly to ensure grid covers entire view
        let margin = gridSize * 2.0;
        let gridLeft = floor((left - margin) / gridSize) * gridSize;
        let gridRight = ceil((right + margin) / gridSize) * gridSize;
        let gridTop = floor((top - margin) / gridSize) * gridSize;
        let gridBottom = ceil((bottom + margin) / gridSize) * gridSize;
        
        // Calculate number of lines
        let numVerticalLines = i32((gridRight - gridLeft) / gridSize) + 1;
        let numHorizontalLines = i32((gridBottom - gridTop) / gridSize) + 1;
        let verticesPerLine = 6; // 2 triangles per line
        
        // Determine which line and which vertex within that line
        let lineIndex = vertexIndex / u32(verticesPerLine);
        let vertexInLine = vertexIndex % u32(verticesPerLine);
        
        var worldPos: vec2<f32>;
        
        if (lineIndex < u32(numVerticalLines)) {
          // Vertical line
          let x = gridLeft + f32(lineIndex) * gridSize;
          switch (vertexInLine) {
            case 0u: { worldPos = vec2<f32>(x - lineWidth/2.0, gridTop); }
            case 1u: { worldPos = vec2<f32>(x + lineWidth/2.0, gridTop); }
            case 2u: { worldPos = vec2<f32>(x - lineWidth/2.0, gridBottom); }
            case 3u: { worldPos = vec2<f32>(x + lineWidth/2.0, gridTop); }
            case 4u: { worldPos = vec2<f32>(x + lineWidth/2.0, gridBottom); }
            case 5u: { worldPos = vec2<f32>(x - lineWidth/2.0, gridBottom); }
            default: { worldPos = vec2<f32>(x, gridTop); }
          }
        } else {
          // Horizontal line
          let lineIdx = lineIndex - u32(numVerticalLines);
          let y = gridTop + f32(lineIdx) * gridSize;
          switch (vertexInLine) {
            case 0u: { worldPos = vec2<f32>(gridLeft, y - lineWidth/2.0); }
            case 1u: { worldPos = vec2<f32>(gridRight, y - lineWidth/2.0); }
            case 2u: { worldPos = vec2<f32>(gridLeft, y + lineWidth/2.0); }
            case 3u: { worldPos = vec2<f32>(gridRight, y - lineWidth/2.0); }
            case 4u: { worldPos = vec2<f32>(gridRight, y + lineWidth/2.0); }
            case 5u: { worldPos = vec2<f32>(gridLeft, y + lineWidth/2.0); }
            default: { worldPos = vec2<f32>(gridLeft, y); }
          }
        }
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos, 0.0, 1.0);
        
        // Grid color - adaptive opacity based on zoom
        let baseAlpha = 0.25;
        let zoomFactor = uniforms.viewport.z;
        let alpha = clamp(baseAlpha * min(zoomFactor * 0.8, 1.2), 0.08, 0.4);
        output.color = vec4<f32>(0.6, 0.6, 0.6, alpha);
        
        return output;
      }

      @fragment
      fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
        return color;
      }
    `;

    const handleShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>,
      }

      struct HandleData {
        position: vec2<f32>,
        size: vec2<f32>,
        color: vec4<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> handleData: array<HandleData>;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
      }

      @vertex
      fn vs_main(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) instanceIndex: u32
      ) -> VertexOutput {
        let positions = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        
        let uvs = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
        );

        let handle = handleData[instanceIndex];
        let localPos = positions[vertexIndex];
        let worldPos = handle.position + localPos * handle.size * 0.5;
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos, 0.0, 1.0);
        output.color = handle.color;
        output.uv = uvs[vertexIndex];
        
        return output;
      }

      @fragment
      fn fs_main(
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>
      ) -> @location(0) vec4<f32> {
        // Simple square handles with border
        let borderWidth = 0.15;
        let center = abs(uv - 0.5);
        let isInBorder = step(center.x, 0.5 - borderWidth) * step(center.y, 0.5 - borderWidth);
        
        if (isInBorder > 0.5) {
          return vec4<f32>(0.1, 0.1, 0.1, 1.0); // Dark interior
        } else {
          return color; // Bright border
        }
      }
    `;

    const nodeShaderModule = this.device.createShaderModule({ code: nodeShaderCode });
    const handleShaderModule = this.device.createShaderModule({ code: handleShaderCode });
    const gridShaderModule = this.device.createShaderModule({ code: gridShaderCode });

    // Create bind group layouts
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' as const }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' as const }
        }
      ]
    });

    // Grid bind group layout needs to match the new uniform structure
    const gridBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' as const }
        }
      ]
    });

    // Create bind groups
    this.nodeBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } }
      ]
    });

    this.handleBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.handleBuffer } }
      ]
    });

    this.gridBindGroup = this.device.createBindGroup({
      layout: gridBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.gridUniformBuffer } }
      ]
    });

    // Create render pipelines
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });

    const gridPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [gridBindGroupLayout]
    });

    this.nodeRenderPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: nodeShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: nodeShaderModule,
        entryPoint: 'fs_main',
        targets: [{ 
          format: navigator.gpu.getPreferredCanvasFormat(),
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }]
      },
      primitive: { topology: 'triangle-list' },
    });

    this.handleRenderPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: handleShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: handleShaderModule,
        entryPoint: 'fs_main',
        targets: [{ 
          format: navigator.gpu.getPreferredCanvasFormat(),
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }]
      },
      primitive: { topology: 'triangle-list'},
    });

    this.gridRenderPipeline = this.device.createRenderPipeline({
      layout: gridPipelineLayout,
      vertex: {
        module: gridShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: gridShaderModule,
        entryPoint: 'fs_main',
        targets: [{ 
          format: navigator.gpu.getPreferredCanvasFormat(),
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }]
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  render(
    visibleNodes: DiagramNode[],
    viewport: Viewport,
    canvasSize: { width: number; height: number },
    selectedNodes: DiagramNode[] = []
  ): void {
    if (!this.initialized || !this.device || !this.context || !this.nodeRenderPipeline) {
      console.warn('WebGPU renderer not properly initialized');
      return;
    }

    try {
      // Validate input data
      if (!Array.isArray(visibleNodes)) {
        console.error('visibleNodes is not an array:', visibleNodes);
        return;
      }

      if (!Array.isArray(selectedNodes)) {
        console.error('selectedNodes is not an array:', selectedNodes);
        return;
      }

      // Update canvas size if needed
      if (this.canvas && (this.canvas.width !== canvasSize.width || this.canvas.height !== canvasSize.height)) {
        this.canvas.width = canvasSize.width;
        this.canvas.height = canvasSize.height;
      }

      // Early exit if no nodes to render
      if (visibleNodes.length === 0) {
        // Still clear the canvas and render grid
        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: textureView,
            clearValue: { r: 0.15, g: 0.15, b: 0.15, a: 1.0 },
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          }],
        });

        // Still render grid even without nodes
        this.renderGrid(renderPass, viewport, canvasSize);
        
        renderPass.end();
        this.device.queue.submit([commandEncoder.finish()]);
        return;
      }

      // Create proper view-projection matrix for 2D rendering
      const viewProjectionMatrix = this.createViewProjectionMatrix(viewport, canvasSize);

      // Update uniform buffers
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height
        ])
      );

      // Update grid uniform buffer with canvas dimensions
      this.device.queue.writeBuffer(
        this.gridUniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height,
          canvasSize.width, canvasSize.height, 0, 0 // Canvas size + padding
        ])
      );

      // Prepare node data with selection information
      const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
      const nodeData: NodeInstanceData[] = visibleNodes.map(node => {
        // Validate node structure
        if (!node.data || !node.data.position) {
          console.warn('Invalid node structure:', node);
          return null;
        }
        
        const color = this.hexToRgba(node.visual?.color || '#3b82f6');
        const size = node.visual?.size || { width: 100, height: 60 };
        
        // Debug: Log what shape we're getting
        console.log('Node shape debug:', {
          nodeId: node.id,
          rawShape: node.visual?.shape,
          shapeType: SHAPE_TYPES[node.visual?.shape as keyof typeof SHAPE_TYPES] ?? 0
        });
        
        const shapeType = SHAPE_TYPES[node.visual?.shape as keyof typeof SHAPE_TYPES] ?? 0;
        const isSelected = selectedNodeIds.has(node.id) ? 1 : 0;
        
        return {
          position: [node.data.position.x, node.data.position.y],
          size: [size.width, size.height],
          color: [color.r, color.g, color.b, color.a],
          shapeType,
          isSelected,
          padding: [0, 0, 0], // padding for struct alignment
        };
      }).filter(Boolean) as NodeInstanceData[]; // Remove null entries

      if (nodeData.length === 0) {
        console.warn('No valid node data to render');
        return;
      }

      // Debug: Log the first few nodes to see what we're actually sending
      console.log('First node data being sent to GPU:', nodeData.slice(0, 3));

      // Resize node buffer if needed
      const requiredNodeSize = nodeData.length * 64; // 16 floats * 4 bytes = 64 bytes per node
      if (requiredNodeSize > this.nodeBuffer!.size) {
        console.log('Resizing node buffer from', this.nodeBuffer!.size, 'to', requiredNodeSize * 2);
        
        this.nodeBuffer!.destroy();
        this.nodeBuffer = this.device.createBuffer({
          size: requiredNodeSize * 2, // Double the size for future growth
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.nodeBindGroup = this.device.createBindGroup({
          layout: this.nodeRenderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer! } },
            { binding: 1, resource: { buffer: this.nodeBuffer } }
          ]
        });
      }

      // Write node data to buffer - MUST match WGSL struct layout exactly!
      const flatNodeData = new Float32Array(nodeData.length * 16); // 16 floats per node to match struct
      nodeData.forEach((node, i) => {
        const offset = i * 16;
        // position: vec2<f32>
        flatNodeData[offset] = node.position[0];
        flatNodeData[offset + 1] = node.position[1];
        // size: vec2<f32>  
        flatNodeData[offset + 2] = node.size[0];
        flatNodeData[offset + 3] = node.size[1];
        // color: vec4<f32>
        flatNodeData[offset + 4] = node.color[0];
        flatNodeData[offset + 5] = node.color[1];
        flatNodeData[offset + 6] = node.color[2];
        flatNodeData[offset + 7] = node.color[3];
        // isSelected: f32
        flatNodeData[offset + 8] = node.isSelected;
        // shapeType: f32 - This is the critical one!
        flatNodeData[offset + 9] = node.shapeType;
        // padding: vec3<f32> (to align to 16-float boundary)
        flatNodeData[offset + 10] = node.padding[0];
        flatNodeData[offset + 11] = node.padding[1];
        flatNodeData[offset + 12] = node.padding[2];
        flatNodeData[offset + 13] = 0; // Extra padding
        flatNodeData[offset + 14] = 0; // Extra padding  
        flatNodeData[offset + 15] = 0; // Extra padding
      });

      this.device.queue.writeBuffer(this.nodeBuffer!, 0, flatNodeData);

      // Generate resize handles for selected nodes
      const handleData: HandleInstanceData[] = [];
      if (selectedNodes.length > 0) {
        const handleSize = Math.max(12 / viewport.zoom, 8); // Minimum 8px handles

        selectedNodes.forEach(node => {
          if (!node.data || !node.data.position) return;
          
          const size = node.visual?.size || { width: 100, height: 100 };
          const { x, y } = node.data.position;
          const halfWidth = size.width / 2;
          const halfHeight = size.height / 2;
          
          const handles = [
            // Corners
            { x: x - halfWidth, y: y - halfHeight, type: 'corner' }, // top-left
            { x: x + halfWidth, y: y - halfHeight, type: 'corner' }, // top-right
            { x: x - halfWidth, y: y + halfHeight, type: 'corner' }, // bottom-left
            { x: x + halfWidth, y: y + halfHeight, type: 'corner' }, // bottom-right
            // Edges
            { x: x, y: y - halfHeight, type: 'edge' },             // top
            { x: x, y: y + halfHeight, type: 'edge' },             // bottom
            { x: x - halfWidth, y: y, type: 'edge' },              // left
            { x: x + halfWidth, y: y, type: 'edge' },              // right
          ];

          handles.forEach(handle => {
            // Different colors for different handle types
            const isCorner = handle.type === 'corner';
            const handleColor: [number, number, number, number] = isCorner ? [1.0, 1.0, 1.0, 1.0] : [0.8, 0.8, 1.0, 1.0]; // White for corners, light blue for edges
            
            handleData.push({
              position: [handle.x, handle.y],
              size: [handleSize, handleSize],
              color: handleColor,
            });
          });
        });
      }

      // Update handle buffer if we have handles
      if (handleData.length > 0) {
        const requiredHandleSize = handleData.length * 32;
        if (requiredHandleSize > this.handleBuffer!.size) {
          this.handleBuffer!.destroy();
          this.handleBuffer = this.device.createBuffer({
            size: requiredHandleSize * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          
          this.handleBindGroup = this.device.createBindGroup({
            layout: this.handleRenderPipeline!.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.uniformBuffer! } },
              { binding: 1, resource: { buffer: this.handleBuffer } }
            ]
          });
        }

        const flatHandleData = new Float32Array(handleData.length * 8); // 8 floats per handle
        handleData.forEach((handle, i) => {
          const offset = i * 8;
          flatHandleData[offset] = handle.position[0];
          flatHandleData[offset + 1] = handle.position[1];
          flatHandleData[offset + 2] = handle.size[0];
          flatHandleData[offset + 3] = handle.size[1];
          flatHandleData[offset + 4] = handle.color[0];
          flatHandleData[offset + 5] = handle.color[1];
          flatHandleData[offset + 6] = handle.color[2];
          flatHandleData[offset + 7] = handle.color[3];
        });

        this.device.queue.writeBuffer(this.handleBuffer!, 0, flatHandleData);
      }

      // Render everything
      const commandEncoder = this.device.createCommandEncoder();
      const textureView = this.context.getCurrentTexture().createView();
      
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0.15, g: 0.15, b: 0.15, a: 1.0 },
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
        }],
      });

      // Render grid first (background)
      this.renderGrid(renderPass, viewport, canvasSize);

      // Render nodes
      if (nodeData.length > 0) {
        renderPass.setPipeline(this.nodeRenderPipeline);
        renderPass.setBindGroup(0, this.nodeBindGroup!);
        renderPass.draw(6, nodeData.length);
      }

      // Render handles
      if (handleData.length > 0 && this.handleRenderPipeline) {
        renderPass.setPipeline(this.handleRenderPipeline);
        renderPass.setBindGroup(0, this.handleBindGroup!);
        renderPass.draw(6, handleData.length);
      }

      renderPass.end();
      this.device.queue.submit([commandEncoder.finish()]);

      console.log('WebGPU render completed successfully');

    } catch (error) {
      console.error('WebGPU render error:', error);
    }
  }

  // Helper method to render grid with proper vertex calculation
  private renderGrid(renderPass: GPURenderPassEncoder, viewport: Viewport, canvasSize: { width: number; height: number }) {
    if (!this.gridRenderPipeline) return;

    // Calculate grid vertices dynamically based on current viewport and canvas size
    const gridSize = 50.0;
    const worldWidth = canvasSize.width / viewport.zoom;
    const worldHeight = canvasSize.height / viewport.zoom;
    const left = viewport.x - worldWidth / 2;
    const right = viewport.x + worldWidth / 2;
    const top = viewport.y - worldHeight / 2;
    const bottom = viewport.y + worldHeight / 2;
    
    // Add margin and snap to grid
    const margin = gridSize * 2;
    const gridLeft = Math.floor((left - margin) / gridSize) * gridSize;
    const gridRight = Math.ceil((right + margin) / gridSize) * gridSize;
    const gridTop = Math.floor((top - margin) / gridSize) * gridSize;
    const gridBottom = Math.ceil((bottom + margin) / gridSize) * gridSize;
    
    const numVerticalLines = Math.floor((gridRight - gridLeft) / gridSize) + 1;
    const numHorizontalLines = Math.floor((gridBottom - gridTop) / gridSize) + 1;
    const totalVertices = (numVerticalLines + numHorizontalLines) * 6; // 6 vertices per line

    console.log('Grid calculation:', {
      canvasSize,
      viewport,
      worldBounds: { left, right, top, bottom },
      gridBounds: { gridLeft, gridRight, gridTop, gridBottom },
      lines: { vertical: numVerticalLines, horizontal: numHorizontalLines },
      totalVertices
    });

    if (totalVertices > 0) {
      renderPass.setPipeline(this.gridRenderPipeline);
      renderPass.setBindGroup(0, this.gridBindGroup!);
      renderPass.draw(totalVertices, 1);
      console.log('Grid rendered with', totalVertices, 'vertices');
    }
  }

  // Fixed view-projection matrix creation for 2D rendering
  private createViewProjectionMatrix(viewport: Viewport, canvasSize: { width: number; height: number }): number[] {
    // Create a 2D orthographic projection matrix
    // We want to map world coordinates directly to screen coordinates
    
    // Calculate the visible world bounds based on viewport
    const worldWidth = canvasSize.width / viewport.zoom;
    const worldHeight = canvasSize.height / viewport.zoom;
    
    const left = viewport.x - worldWidth / 2;
    const right = viewport.x + worldWidth / 2;
    const bottom = viewport.y + worldHeight / 2; // Note: Y is flipped for screen coordinates
    const top = viewport.y - worldHeight / 2;
    
    // Create orthographic projection matrix that maps world coords to NDC (-1 to 1)
    const orthoMatrix = this.createOrthographicMatrix(left, right, bottom, top, -1, 1);
    
    return orthoMatrix;
  }

  private createOrthographicMatrix(
    left: number, right: number,
    bottom: number, top: number,
    near: number, far: number
  ): number[] {
    const width = right - left;
    const height = top - bottom;
    const depth = far - near;

    return [
      2 / width, 0, 0, 0,
      0, 2 / height, 0, 0,
      0, 0, -2 / depth, 0,
      -(right + left) / width, -(top + bottom) / height, -(far + near) / depth, 1,
    ];
  }

  private hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
    const cleanHex = hex.replace('#', '');
    
    if (cleanHex.length === 8) {
      return {
        r: parseInt(cleanHex.substr(0, 2), 16) / 255,
        g: parseInt(cleanHex.substr(2, 2), 16) / 255,
        b: parseInt(cleanHex.substr(4, 2), 16) / 255,
        a: parseInt(cleanHex.substr(6, 2), 16) / 255,
      };
    } else if (cleanHex.length === 6) {
      return {
        r: parseInt(cleanHex.substr(0, 2), 16) / 255,
        g: parseInt(cleanHex.substr(2, 2), 16) / 255,
        b: parseInt(cleanHex.substr(4, 2), 16) / 255,
        a: 1.0,
      };
    } else {
      return { r: 0.23, g: 0.51, b: 0.96, a: 1.0 };
    }
  }

  destroy(): void {
    try {
      if (this.nodeBuffer) {
        this.nodeBuffer.destroy();
        this.nodeBuffer = null;
      }
      
      if (this.handleBuffer) {
        this.handleBuffer.destroy();
        this.handleBuffer = null;
      }
      
      if (this.uniformBuffer) {
        this.uniformBuffer.destroy();
        this.uniformBuffer = null;
      }

      if (this.gridUniformBuffer) {
        this.gridUniformBuffer.destroy();
        this.gridUniformBuffer = null;
      }

      this.root = null;
      this.context = null;
      this.nodeRenderPipeline = null;
      this.handleRenderPipeline = null;
      this.gridRenderPipeline = null;
      this.nodeBindGroup = null;
      this.handleBindGroup = null;
      this.gridBindGroup = null;
      this.device = null;
      this.initialized = false;
      this.canvas = null;

      console.log('Fixed WebGPU renderer destroyed');
    } catch (error) {
      console.error('Error destroying WebGPU renderer:', error);
    }
  }
}

// Export shape types for external use
export const SHAPE_TYPES = {
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