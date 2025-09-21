/// <reference types="@webgpu/types" />
import type { DiagramNode, Viewport } from '../types';
import tgpu from 'typegpu'

interface NodeInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
  isSelected: number; // 0 or 1
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
  private nodeBuffer: GPUBuffer | null = null;
  private handleBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private nodeBindGroup: GPUBindGroup | null = null;
  private handleBindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  public initialized = false;
  private canvas: HTMLCanvasElement | null = null;

  async testMinimalRendering(): Promise<void> {
  if (!this.device || !this.context) {
    console.error('❌ Device or context not initialized');
    return;
  }

  console.log('🧪 Starting minimal rendering test...');

  // 1. Test basic draw call with no data
  try {
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, // Bright red clear
        loadOp: 'clear' as const,
        storeOp: 'store' as const,
      }],
    });
    
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    
    console.log('✅ Test 1: Basic clear (should see red background)');
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
    return;
  }

  // Wait a bit then test simple draw
  setTimeout(() => this.testSimpleDraw(), 100);
}

async testSimpleDraw(): Promise<void> {
  console.log('🧪 Test 2: Simple hardcoded triangle...');

  // Create the simplest possible shader
  const simpleShader = /* wgsl */`
    @vertex
    fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
      // Hardcoded triangle in NDC space (-1 to 1)
      let positions = array<vec2<f32>, 3>(
        vec2<f32>(-0.5, -0.5),  // Bottom left
        vec2<f32>( 0.5, -0.5),  // Bottom right  
        vec2<f32>( 0.0,  0.5)   // Top center
      );
      
      return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    }

    @fragment
    fn fs_main() -> @location(0) vec4<f32> {
      return vec4<f32>(0.0, 1.0, 0.0, 1.0); // Green triangle
    }
  `;

  try {
    const shaderModule = this.device!.createShaderModule({ code: simpleShader });
    
    const pipeline = this.device!.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
      },
      primitive: { topology: 'triangle-list' },
    });

    const commandEncoder = this.device!.createCommandEncoder();
    const textureView = this.context!.getCurrentTexture().createView();
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.0, g: 0.0, b: 1.0, a: 1.0 }, // Blue background
        loadOp: 'clear' as const,
        storeOp: 'store' as const,
      }],
    });
    
    renderPass.setPipeline(pipeline);
    renderPass.draw(3, 1); // 3 vertices, 1 instance
    renderPass.end();
    
    this.device!.queue.submit([commandEncoder.finish()]);
    
    console.log('✅ Test 2: Simple triangle (should see green triangle on blue)');
    
    // Test instancing next
    setTimeout(() => this.testInstancing(), 100);
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }
}

async testInstancing(): Promise<void> {
  console.log('🧪 Test 3: Basic instancing...');

  const instanceShader = /* wgsl */`
    @vertex
    fn vs_main(
      @builtin(vertex_index) vertexIndex: u32,
      @builtin(instance_index) instanceIndex: u32
    ) -> @builtin(position) vec4<f32> {
      // Single triangle
      let positions = array<vec2<f32>, 3>(
        vec2<f32>(-0.1, -0.1),
        vec2<f32>( 0.1, -0.1),  
        vec2<f32>( 0.0,  0.1)
      );
      
      // Offset each instance
      let instanceOffset = vec2<f32>(
        f32(instanceIndex) * 0.4 - 0.4, // -0.4, 0.0, 0.4
        0.0
      );
      
      let finalPos = positions[vertexIndex] + instanceOffset;
      return vec4<f32>(finalPos, 0.0, 1.0);
    }

    @fragment
    fn fs_main() -> @location(0) vec4<f32> {
      return vec4<f32>(1.0, 1.0, 0.0, 1.0); // Yellow triangles
    }
  `;

  try {
    const shaderModule = this.device!.createShaderModule({ code: instanceShader });
    
    const pipeline = this.device!.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }]
      },
      primitive: { topology: 'triangle-list' },
    });

    const commandEncoder = this.device!.createCommandEncoder();
    const textureView = this.context!.getCurrentTexture().createView();
    
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.2, g: 0.2, b: 0.2, a: 1.0 }, // Gray background
        loadOp: 'clear' as const,
        storeOp: 'store' as const,
      }],
    });
    
    renderPass.setPipeline(pipeline);
    renderPass.draw(3, 3); // 3 vertices, 3 instances
    renderPass.end();
    
    this.device!.queue.submit([commandEncoder.finish()]);
    
    console.log('✅ Test 3: Instancing (should see 3 yellow triangles)');
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }
}

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

    this.nodeBuffer = this.device.createBuffer({
      size: 1000 * 48, // Support up to 1000 nodes (12 floats * 4 bytes each)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.handleBuffer = this.device.createBuffer({
      size: 8 * 32, // Up to 8 handles per selected node (8 floats * 4 bytes each)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Fixed WGSL shader with proper coordinate system
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
        padding: vec3<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> nodeData: array<NodeData>;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) isSelected: f32,
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
        
        return output;
      }

      @fragment
      fn fs_main(
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) isSelected: f32
      ) -> @location(0) vec4<f32> {
        // Create rounded rectangle
        let cornerRadius = 0.1;
        let edgeDistance = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
        let roundedEdge = smoothstep(0.45, 0.45 - cornerRadius, edgeDistance);
        
        // Selection border effect
        if (isSelected > 0.5) {
          // Create selection border
          let borderWidth = 0.05;
          let borderDistance = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
          let isInBorder = step(0.45 - borderWidth, borderDistance) * step(borderDistance, 0.45);
          
          if (isInBorder > 0.5) {
            // Red selection border
            return vec4<f32>(0.94, 0.26, 0.26, 1.0) * roundedEdge;
          }
        }
        
        return vec4<f32>(color.rgb, color.a * roundedEdge);
      }
    `;

    // Shader for resize handles
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
        let borderWidth = 0.1;
        let isInBorder = step(borderWidth, uv.x) * step(uv.x, 1.0 - borderWidth) * 
                        step(borderWidth, uv.y) * step(uv.y, 1.0 - borderWidth);
        
        if (isInBorder > 0.5) {
          return vec4<f32>(0.0, 0.0, 0.0, 1.0); // Black interior
        } else {
          return color; // White border
        }
      }
    `;

    const nodeShaderModule = this.device.createShaderModule({ code: nodeShaderCode });
    const handleShaderModule = this.device.createShaderModule({ code: handleShaderCode });

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

    // Create render pipelines
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
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
      primitive: { topology: 'triangle-list' as const },
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
      primitive: { topology: 'triangle-list' as const },
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

      console.log('WebGPU render called:', { 
        visibleNodes: visibleNodes.length, 
        selectedNodes: selectedNodes.length,
        viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
        canvasSize
      });

        console.log('🔍 DETAILED DRAW CALL DIAGNOSTIC');
  console.log('=====================================');
  
  // Check render pipeline state
  console.log('🏗️ Render Pipeline State:', {
    pipeline: !!this.nodeRenderPipeline,
    bindGroup: !!this.nodeBindGroup,
    device: !!this.device,
    context: !!this.context
  });

  // Check canvas state
  if (this.canvas) {
    console.log('🖼️ Canvas State:', {
      width: this.canvas.width,
      height: this.canvas.height,
      actualSize: { width: canvasSize.width, height: canvasSize.height }
    });
  }

      // Update canvas size if needed
      if (this.canvas && (this.canvas.width !== canvasSize.width || this.canvas.height !== canvasSize.height)) {
        this.canvas.width = canvasSize.width;
        this.canvas.height = canvasSize.height;
        console.log('Canvas resized to:', canvasSize);
      }

      // Early exit if no nodes to render
      if (visibleNodes.length === 0) {
        // Still clear the canvas
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
        renderPass.end();
        this.device.queue.submit([commandEncoder.finish()]);
        return;
      }

      // Create proper view-projection matrix for 2D rendering
      const viewProjectionMatrix = this.createViewProjectionMatrix(viewport, canvasSize);

      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height
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
        const isSelected = selectedNodeIds.has(node.id) ? 1 : 0;
        
        return {
          position: [node.data.position.x, node.data.position.y],
          size: [size.width, size.height],
          color: [color.r, color.g, color.b, color.a],
          isSelected,
          padding: [0, 0, 0], // padding for struct alignment
        };
      }).filter(Boolean) as NodeInstanceData[]; // Remove null entries

      if (nodeData.length === 0) {
        console.warn('No valid node data to render');
        return;
      }

      // Resize node buffer if needed
      const requiredNodeSize = nodeData.length * 48; // 12 floats * 4 bytes
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

      // Write node data to buffer
      const flatNodeData = new Float32Array(nodeData.length * 16); // 12 floats per node
      nodeData.forEach((node, i) => {
        const offset = i * 16;
        flatNodeData[offset] = node.position[0];
        flatNodeData[offset + 1] = node.position[1];
        flatNodeData[offset + 2] = node.size[0];
        flatNodeData[offset + 3] = node.size[1];
        flatNodeData[offset + 4] = node.color[0];
        flatNodeData[offset + 5] = node.color[1];
        flatNodeData[offset + 6] = node.color[2];
        flatNodeData[offset + 7] = node.color[3];
        flatNodeData[offset + 8] = node.isSelected;
        flatNodeData[offset + 9] = node.padding[0];
        flatNodeData[offset + 10] = node.padding[1];
        flatNodeData[offset + 11] = node.padding[2];
      });

      this.device.queue.writeBuffer(this.nodeBuffer!, 0, flatNodeData);

      // Generate resize handles for selected nodes
      const handleData: HandleInstanceData[] = [];
      if (selectedNodes.length > 0) {
        const handleSize = Math.max(12 / viewport.zoom, 8); // Minimum 8px handles

        selectedNodes.forEach(node => {
          if (!node.data || !node.data.position) return;
          
          const size = node.visual?.size || { width: 100, height: 60 };
          const { x, y } = node.data.position;
          const halfWidth = size.width / 2;
          const halfHeight = size.height / 2;

          // Create 8 resize handles around the node
          const handles = [
            // Corners
            { x: x - halfWidth, y: y - halfHeight }, // top-left
            { x: x + halfWidth, y: y - halfHeight }, // top-right
            { x: x - halfWidth, y: y + halfHeight }, // bottom-left
            { x: x + halfWidth, y: y + halfHeight }, // bottom-right
            // Edges
            { x: x, y: y - halfHeight },             // top
            { x: x, y: y + halfHeight },             // bottom
            { x: x - halfWidth, y: y },              // left
            { x: x + halfWidth, y: y },              // right
          ];

          handles.forEach(handle => {
            handleData.push({
              position: [handle.x, handle.y],
              size: [handleSize, handleSize],
              color: [1.0, 1.0, 1.0, 1.0], // White handles
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

      this.root = null;
      this.context = null;
      this.nodeRenderPipeline = null;
      this.handleRenderPipeline = null;
      this.nodeBindGroup = null;
      this.handleBindGroup = null;
      this.device = null;
      this.initialized = false;
      this.canvas = null;

      console.log('Fixed WebGPU renderer destroyed');
    } catch (error) {
      console.error('Error destroying WebGPU renderer:', error);
    }
  }
}