
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
      console.log('Enhanced WebGPU renderer initialized successfully');
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

    // Enhanced WGSL shader for nodes with selection support
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
          vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
          vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
        );

        let node = nodeData[instanceIndex];
        let localPos = positions[vertexIndex];
        
        // Add selection padding if selected
        let selectionPadding = node.isSelected * 4.0; // 4 pixel padding when selected
        let adjustedSize = node.size + vec2<f32>(selectionPadding, selectionPadding);
        
        let worldPos = node.position + localPos * adjustedSize * 0.5;
        
        var output: VertexOutput;
        let screenPos = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, 0.0, 1.0);
        output.position = vec4<f32>(screenPos.x, screenPos.y, screenPos.z, screenPos.w);
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
        let center = vec2<f32>(0.5, 0.5);
        let dist = distance(uv, center);
        
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
          vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
          vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
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
        // Simple square handles
        return color;
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
        viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
      });

      // Log each visible node
        visibleNodes.forEach((node, i) => {
          console.log(`  Node ${i}:`, {
            id: node.id,
            position: node.data?.position,
            size: node.visual?.size
          })});

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

      // Update uniform buffer with viewport transform
      const aspectRatio = canvasSize.width / canvasSize.height;
      const zoom = viewport.zoom;
      
      const left = viewport.x;
      const right = viewport.x + (canvasSize.width / zoom);
      const top = viewport.y;  // Note: top < bottom for Y-down
      const bottom = viewport.y + (canvasSize.height / zoom);

      const orthoMatrix = this.createOrthographicMatrix(left, right, bottom, top, -1, 1);
      const viewMatrix = this.createTranslationMatrix(-viewport.x, -viewport.y, 0);
      const viewProjectionMatrix = this.multiplyMatrices(orthoMatrix, viewMatrix);

      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, aspectRatio
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
      const flatNodeData = new Float32Array(nodeData.length * 12); // 12 floats per node
      nodeData.forEach((node, i) => {
        const offset = i * 12;
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

      // Generate resize handles for selected nodes (only if we have selected nodes)
      const handleData: HandleInstanceData[] = [];
      if (selectedNodes.length > 0) {
        const handleSize = Math.max(8 / viewport.zoom, 4); // Minimum 4px handles

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
      // Don't set initialized to false on render errors, just log them
    }
  }

  // ... (keep all the existing helper methods from the previous version)
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

  private createTranslationMatrix(x: number, y: number, z: number): number[] {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ];
  }

  private multiplyMatrices(a: number[], b: number[]): number[] {
    const result = new Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[i * 4 + j] = 
          a[i * 4 + 0] * b[0 * 4 + j] +
          a[i * 4 + 1] * b[1 * 4 + j] +
          a[i * 4 + 2] * b[2 * 4 + j] +
          a[i * 4 + 3] * b[3 * 4 + j];
      }
    }
    return result;
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

      console.log('Enhanced WebGPU renderer destroyed');
    } catch (error) {
      console.error('Error destroying WebGPU renderer:', error);
    }
  }
}