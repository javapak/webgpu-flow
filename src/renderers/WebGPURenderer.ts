// renderers/TypeGPUSpatialRenderer.ts
import tgpu from 'typegpu';
import type { DiagramNode, Viewport } from '../types';

interface NodeInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
}

export class WebGPURenderer {
  private root: any = null;
  private context: any | null = null;
  private renderPipeline: any = null;
  private nodeBuffer: any | null = null;
  private uniformBuffer: any| null = null;
  private bindGroup: any | null = null;
  private initialized = false;

  async initialize(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      // Initialize TypeGPU
      this.root = await tgpu.init();
      
      // Get WebGPU context
      this.context = canvas.getContext('webgpu');
      if (!this.context) {
        console.error('Failed to get WebGPU context');
        return false;
      }

      // Configure canvas context
      this.context.configure({
        device: this.root.device,
        format: (navigator as any).gpu.getPreferredCanvasFormat(),
        alphaMode: 'premultiplied',
      });

      await this.setupRenderPipeline();
      this.initialized = true;
      return true;

    } catch (error) {
      console.error('TypeGPU initialization failed:', error);
      return false;
    }
  }

  private async setupRenderPipeline() {
    if (!this.root) return;

    // Create buffers using standard WebGPU API (TypeGPU buffer creation may vary)
    this.uniformBuffer = this.root.device.createBuffer({
      size: 80, // mat4x4 + vec4
      usage: 0x40 | 0x4, // UNIFORM | COPY_DST
    });

    this.nodeBuffer = this.root.device.createBuffer({
      size: 1000 * 32, // Support up to 1000 nodes initially (8 floats * 4 bytes each)
      usage: 0x80 | 0x4, // STORAGE | COPY_DST
    });

    // WGSL shader code using standard WebGPU shader module
    const shaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
      }

      struct NodeData {
        position: vec2<f32>,
        size: vec2<f32>,
        color: vec4<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> nodeData: array<NodeData>;

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
        let worldPos = node.position + localPos * node.size * 0.5;
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos, 0.0, 1.0);
        output.color = node.color;
        output.uv = uvs[vertexIndex];
        
        return output;
      }

      @fragment
      fn fs_main(
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>
      ) -> @location(0) vec4<f32> {
        // Create rounded rectangle
        let center = vec2<f32>(0.5, 0.5);
        let dist = distance(uv, center);
        let radius = 0.1;
        let edge = smoothstep(0.45, 0.45 - radius, dist);
        
        return vec4<f32>(color.rgb, color.a * edge);
      }
    `;

    const shaderModule = this.root.device.createShaderModule({
      code: shaderCode,
    });

    // Create bind group layout
    const bindGroupLayout = this.root.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 1, // VERTEX
          buffer: { type: 'uniform' as const }
        },
        {
          binding: 1,
          visibility: 1, // VERTEX
          buffer: { type: 'read-only-storage' as const }
        }
      ]
    });

    this.bindGroup = this.root.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } }
      ]
    });

    // Create render pipeline using standard WebGPU API
    this.renderPipeline = this.root.device.createRenderPipeline({
      layout: this.root.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: (navigator as any).gpu!.getPreferredCanvasFormat() }]
      },
      primitive: {
        topology: 'triangle-list' as const,
      }
    });
  }

  render(
    visibleNodes: DiagramNode[],
    viewport: Viewport,
    canvasSize: { width: number; height: number }
  ): void {
    if (!this.initialized || !this.root || !this.context || !this.renderPipeline) {
      return;
    }

    try {
      // Update uniform buffer with viewport transform
      const aspectRatio = canvasSize.width / canvasSize.height;
      const zoom = viewport.zoom;
      
      // Create orthographic projection matrix
      const left = -canvasSize.width / (2 * zoom);
      const right = canvasSize.width / (2 * zoom);
      const bottom = -canvasSize.height / (2 * zoom);
      const top = canvasSize.height / (2 * zoom);
      
      const orthoMatrix = this.createOrthographicMatrix(left, right, bottom, top, -1, 1);
      const viewMatrix = this.createTranslationMatrix(-viewport.x, -viewport.y, 0);
      const viewProjectionMatrix = this.multiplyMatrices(orthoMatrix, viewMatrix);

      this.root.device.queue.writeBuffer(
        this.uniformBuffer,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, aspectRatio
        ])
      );

      // Update node data
      const nodeData: NodeInstanceData[] = visibleNodes.map(node => {
        const color = this.hexToRgba(node.visual?.color || '#3b82f6');
        const size = node.data.size || { width: 100, height: 60 };
        
        return {
          position: [node.data.position.x, node.data.position.y],
          size: [size.width, size.height],
          color: [color.r, color.g, color.b, color.a],
        };
      });

      // Resize buffer if needed
      const requiredSize = nodeData.length * 32; // 8 floats * 4 bytes each
      if (requiredSize > this.nodeBuffer!.size) {
        this.nodeBuffer!.destroy();
        this.nodeBuffer = this.root.device.createBuffer({
          size: Math.max(requiredSize * 2, 1000 * 32),
          usage: 0x80 | 0x4, // STORAGE | COPY_DST
        });
        
        // Recreate bind group with new buffer
        this.bindGroup = this.root.device.createBindGroup({
          layout: this.renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer } },
            { binding: 1, resource: { buffer: this.nodeBuffer } }
          ]
        });
      }

      // Write node data to buffer
      if (nodeData.length > 0) {
        const flatData = new Float32Array(nodeData.length * 8); // 8 floats per node
        nodeData.forEach((node, i) => {
          const offset = i * 8;
          flatData[offset] = node.position[0];
          flatData[offset + 1] = node.position[1];
          flatData[offset + 2] = node.size[0];
          flatData[offset + 3] = node.size[1];
          flatData[offset + 4] = node.color[0];
          flatData[offset + 5] = node.color[1];
          flatData[offset + 6] = node.color[2];
          flatData[offset + 7] = node.color[3];
        });

        this.root.device.queue.writeBuffer(this.nodeBuffer, 0, flatData);
      }

      // Render
      const commandEncoder = this.root.device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
        }],
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.draw(6, visibleNodes.length); // 6 vertices per quad, instanced

      renderPass.end();
      this.root.device.queue.submit([commandEncoder.finish()]);

    } catch (error) {
      console.error('Render error:', error);
    }
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
      2 / width, 0, 0, -(right + left) / width,
      0, 2 / height, 0, -(top + bottom) / height,
      0, 0, -2 / depth, -(far + near) / depth,
      0, 0, 0, 1,
    ];
  }

  private createTranslationMatrix(x: number, y: number, z: number): number[] {
    return [
      1, 0, 0, x,
      0, 1, 0, y,
      0, 0, 1, z,
      0, 0, 0, 1,
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
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255,
      a: 1.0,
    } : { r: 0.23, g: 0.51, b: 0.96, a: 1.0 }; // Default blue
  }

  destroy(): void {
    // TypeGPU handles cleanup automatically
    this.initialized = false;
    this.root = null;
    this.context = null;
    this.renderPipeline = null;
    this.nodeBuffer = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
  }
}

