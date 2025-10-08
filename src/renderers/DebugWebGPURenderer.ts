import tgpu from 'typegpu';
import type { DiagramNode, Viewport } from '../types';

interface NodeInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
  isSelected: number;
  padding: [number, number, number];
}

export class DebugWebGPURenderer {
  private root: any = null;
  private context: GPUCanvasContext | null = null;
  private nodeRenderPipeline: GPURenderPipeline | null = null;
  private nodeBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private nodeBindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  public initialized = false;
  private canvas: HTMLCanvasElement | null = null;

  async initialize(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      if (!navigator.gpu) {
        console.warn('WebGPU not supported in this browser');
        return false;
      }

      this.canvas = canvas;
      this.root = await tgpu.init();
      this.device = this.root.device;
      
      this.context = canvas.getContext('webgpu') as GPUCanvasContext;
      if (!this.context) {
        console.error('Failed to get WebGPU context');
        return false;
      }

      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device!,
        format: canvasFormat,
        alphaMode: 'premultiplied',
      });

      await this.setupRenderPipeline();
      this.initialized = true;
      console.log('✅ Debug WebGPU renderer initialized');
      return true;

    } catch (error) {
      console.error('❌ WebGPU initialization failed:', error);
      this.initialized = false;
      return false;
    }
  }

  private async setupRenderPipeline() {
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

    // Debug-enhanced WGSL shader with coordinate logging
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
        @location(3) worldPos: vec2<f32>, // Debug: pass world position to fragment
        @location(4) nodeIndex: f32,      // Debug: pass node index
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
        let selectionPadding = node.isSelected * 4.0;
        let adjustedSize = node.size + vec2<f32>(selectionPadding, selectionPadding);
        
        // Calculate world position
        let worldPos = node.position + localPos * adjustedSize * 0.5;
        
        // Transform to clip space
        let clipPos = uniforms.viewProjection * vec4<f32>(worldPos, 0.0, 1.0);
        
        var output: VertexOutput;
        output.position = clipPos;
        output.color = node.color;
        output.uv = uvs[vertexIndex];
        output.isSelected = node.isSelected;
        output.worldPos = worldPos;
        output.nodeIndex = f32(instanceIndex);
        
        return output;
      }

      @fragment
      fn fs_main(
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) isSelected: f32,
        @location(3) worldPos: vec2<f32>,
        @location(4) nodeIndex: f32
      ) -> @location(0) vec4<f32> {
        let center = vec2<f32>(0.5, 0.5);
        
        // Create rounded rectangle
        let cornerRadius = 0.1;
        let edgeDistance = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
        let roundedEdge = smoothstep(0.45, 0.45 - cornerRadius, edgeDistance);
        
        // Selection border effect
        if (isSelected > 0.5) {
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

    const nodeShaderModule = this.device.createShaderModule({ code: nodeShaderCode });

    // Create bind group layout
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' as const }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' as const }
        }
      ]
    });

    this.nodeBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } }
      ]
    });

    // Create render pipeline
    this.nodeRenderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
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
  }

  render(
    visibleNodes: DiagramNode[],
    viewport: Viewport,
    canvasSize: { width: number; height: number },
    selectedNodes: DiagramNode[] = []
  ): void {
    if (!this.initialized || !this.device || !this.context || !this.nodeRenderPipeline) {
      console.warn('⚠️ Renderer not initialized');
      return;
    }

    try {
      console.log('🎨 === RENDER DEBUG START ===');
      console.log('📊 Input Data:', {
        visibleNodes: visibleNodes.length,
        selectedNodes: selectedNodes.length,
        viewport: viewport,
        canvasSize: canvasSize
      });

      // Update canvas size if needed
      if (this.canvas && (this.canvas.width !== canvasSize.width || this.canvas.height !== canvasSize.height)) {
        this.canvas.width = canvasSize.width;
        this.canvas.height = canvasSize.height;
        console.log('📐 Canvas resized:', canvasSize);
      }

      // Early exit if no nodes
      if (visibleNodes.length === 0) {
        console.log('⚠️ No nodes to render, clearing canvas');
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

      // === COORDINATE SYSTEM DEBUG ===
      console.log('🗺️ === COORDINATE SYSTEM DEBUG ===');
      
      // Calculate viewport transformation
      const aspectRatio = canvasSize.width / canvasSize.height;
      const zoom = viewport.zoom;
      
      console.log('🔍 Viewport Details:', {
        position: { x: viewport.x, y: viewport.y },
        zoom: zoom,
        aspectRatio: aspectRatio,
        canvasSize: canvasSize
      });
      
      // Calculate orthographic projection bounds
      const left = -canvasSize.width / (2 * zoom);
      const right = canvasSize.width / (2 * zoom);
      const bottom = -canvasSize.height / (2 * zoom);
      const top = canvasSize.height / (2 * zoom);
      
      console.log('Projection Bounds:', { left, right, bottom, top });
      
      const orthoMatrix = this.createOrthographicMatrix(left, right, bottom, top, -1, 1);
      const viewMatrix = this.createTranslationMatrix(-viewport.x, -viewport.y, 0);
      const viewProjectionMatrix = this.multiplyMatrices(orthoMatrix, viewMatrix);
      
      console.log('Matrices:');
      console.log('Ortho:', this.formatMatrix(orthoMatrix));
      console.log('View:', this.formatMatrix(viewMatrix));
      console.log('Combined:', this.formatMatrix(viewProjectionMatrix));

      // Update uniform buffer
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, aspectRatio
        ])
      );

      // === NODE DATA DEBUG ===
      console.log('🎯 === NODE DATA DEBUG ===');
      
      const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
      const nodeData: NodeInstanceData[] = visibleNodes.map((node, index) => {
        if (!node.data || !node.data.position) {
          console.error('❌ Invalid node structure:', node);
          return null;
        }

        const color = this.hexToRgba(node.visual?.color || '#3b82f6');
        const size = node.data.size || { width: 100, height: 60 };
        const isSelected = selectedNodeIds.has(node.id) ? 1 : 0;
        
        console.log(`📍 Node ${index} (${node.id}):`, {
          worldPosition: node.data.position,
          size: size,
          color: color,
          isSelected: isSelected
        });
        
        // Test coordinate transformation manually
        const worldPos = node.data.position;
        const transformed = this.transformPoint(worldPos, viewProjectionMatrix);
        const screenPos = this.clipToScreen(transformed, canvasSize);
        
        console.log(`  🔄 Transforms:`, {
          world: worldPos,
          clip: transformed,
          screen: screenPos,
          visible: (Math.abs(transformed.x) <= 1 && Math.abs(transformed.y) <= 1)
        });
        
        return {
          position: [worldPos.x, worldPos.y],
          size: [size.width, size.height],
          color: [color.r, color.g, color.b, color.a],
          isSelected,
          padding: [0, 0, 0],
        };
      }).filter(Boolean) as NodeInstanceData[];

      if (nodeData.length === 0) {
        console.warn('⚠️ No valid node data after processing');
        return;
      }

      // Resize node buffer if needed
      const requiredNodeSize = nodeData.length * 48;
      if (requiredNodeSize > this.nodeBuffer!.size) {
        console.log('📈 Resizing node buffer:', this.nodeBuffer!.size, '->', requiredNodeSize * 2);
        
        this.nodeBuffer!.destroy();
        this.nodeBuffer = this.device.createBuffer({
          size: requiredNodeSize * 2,
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

      // Write node data to GPU buffer
      const flatNodeData = new Float32Array(nodeData.length * 12);
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

      console.log('📤 GPU Buffer Data (first node):', {
        position: [flatNodeData[0], flatNodeData[1]],
        size: [flatNodeData[2], flatNodeData[3]],
        color: [flatNodeData[4], flatNodeData[5], flatNodeData[6], flatNodeData[7]],
        isSelected: flatNodeData[8]
      });

      this.device.queue.writeBuffer(this.nodeBuffer!, 0, flatNodeData);

      // === RENDER EXECUTION ===
      console.log('🎬 === EXECUTING RENDER ===');
      
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

      renderPass.setPipeline(this.nodeRenderPipeline);
      renderPass.setBindGroup(0, this.nodeBindGroup!);
      renderPass.draw(6, nodeData.length); // 6 vertices per quad, instanced

      renderPass.end();
      this.device.queue.submit([commandEncoder.finish()]);

      console.log('✅ Render completed successfully');
      console.log('🎨 === RENDER DEBUG END ===');

    } catch (error) {
      console.error('❌ Render error:', error);
    }
  }

  // Helper functions for coordinate debugging
  private transformPoint(worldPos: { x: number; y: number }, matrix: number[]): { x: number; y: number; z: number; w: number } {
    const x = worldPos.x;
    const y = worldPos.y;
    const z = 0;
    const w = 1;
    
    return {
      x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
      y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
      z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
      w: matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
    };
  }

  private clipToScreen(clipPos: { x: number; y: number; z: number; w: number }, canvasSize: { width: number; height: number }) {
    const ndcX = clipPos.x / clipPos.w;
    const ndcY = clipPos.y / clipPos.w;
    
    return {
      x: (ndcX + 1) * 0.5 * canvasSize.width,
      y: (1 - ndcY) * 0.5 * canvasSize.height
    };
  }

  private formatMatrix(matrix: number[]): string {
    return `[\n  ${matrix.slice(0, 4).map(n => n.toFixed(3)).join(', ')}\n  ${matrix.slice(4, 8).map(n => n.toFixed(3)).join(', ')}\n  ${matrix.slice(8, 12).map(n => n.toFixed(3)).join(', ')}\n  ${matrix.slice(12, 16).map(n => n.toFixed(3)).join(', ')}\n]`;
  }

  // Keep existing helper methods
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
      
      if (this.uniformBuffer) {
        this.uniformBuffer.destroy();
        this.uniformBuffer = null;
      }

      this.root = null;
      this.context = null;
      this.nodeRenderPipeline = null;
      this.nodeBindGroup = null;
      this.device = null;
      this.initialized = false;
      this.canvas = null;

      console.log('🧹 Debug WebGPU renderer destroyed');
    } catch (error) {
      console.error('❌ Error destroying renderer:', error);
    }
  }
}