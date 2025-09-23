// src/renderers/LabelRenderer.ts
import { TextureAtlas } from './TextureAtlas';
import type { DiagramNode, Viewport } from '../types';

export interface LabelInstanceData {
  // Reordered to match WGSL struct for alignment
  texCoords: [number, number, number, number]; // UV coordinates in atlas (u1, v1, u2, v2)
  color: [number, number, number, number];     // Text color
  position: [number, number];     // World position
  size: [number, number];         // Label size in world units
}

export class LabelRenderer {
  private device: GPUDevice;
  private textAtlas: TextureAtlas;
  private labelRenderPipeline: GPURenderPipeline | null = null;
  private labelBindGroup: GPUBindGroup | null = null;
  private labelBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer;
  
  constructor(device: GPUDevice, uniformBuffer: GPUBuffer) {
    this.device = device;
    this.uniformBuffer = uniformBuffer;
    this.textAtlas = new TextureAtlas(device);
  }

  async initialize(): Promise<void> {
    await this.setupLabelRenderPipeline();
    console.log('LabelRenderer initialized successfully');
  }

  private async setupLabelRenderPipeline() {
    // Label buffer for batched label data
    // Size remains the same: 12 floats * 4 bytes = 48 bytes per label
    this.labelBuffer = this.device.createBuffer({
      size: 1000 * 48, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Batched label shader with corrected struct alignment
    const labelShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
      }

      // Aligned for WebGPU storage buffer rules
      struct LabelData {
        // Start with the largest types for better alignment
        @align(16) texCoords: vec4<f32>, 
        @align(16) color: vec4<f32>,
        
        // Follow with medium types
        @align(8) position: vec2<f32>,
        @align(8) size: vec2<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> labelData: array<LabelData>;
      @group(0) @binding(2) var textSampler: sampler;
      @group(0) @binding(3) var textAtlas: texture_2d<f32>;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) color: vec4<f32>,
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

        let label = labelData[instanceIndex];
        let localPos = positions[vertexIndex];
        let uv = uvs[vertexIndex];
        
        // Calculate world position for the label quad
        let worldPos = label.position + localPos * label.size * 0.5;
        
        // Map UV to atlas coordinates
        let atlasUV = mix(label.texCoords.xy, label.texCoords.zw, uv);
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos, 0.0, 1.0);
        output.uv = atlasUV;
        output.color = label.color;
        
        return output;
      }

      @fragment
      fn fs_main(
        @location(0) uv: vec2<f32>,
        @location(1) color: vec4<f32>
      ) -> @location(0) vec4<f32> {
        let textSample = textureSample(textAtlas, textSampler, uv);
        
        // Use the alpha channel for text rendering
        // White text on transparent background
        return vec4<f32>(color.rgb, textSample.a * color.a);
      }
    `;

    const labelShaderModule = this.device.createShaderModule({ code: labelShaderCode });

    // Create bind group layout for batched labels
    const labelBindGroupLayout = this.device.createBindGroupLayout({
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
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }
      ]
    });

    // Create render pipeline for batched labels
    const labelPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [labelBindGroupLayout]
    });

    this.labelRenderPipeline = this.device.createRenderPipeline({
      layout: labelPipelineLayout,
      vertex: {
        module: labelShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: labelShaderModule,
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

    // Create bind group (will be updated when atlas texture is ready)
    this.updateBindGroup();
  }

  private updateBindGroup() {
    if (!this.labelRenderPipeline || !this.textAtlas.getTexture()) return;

    const textSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.labelBindGroup = this.device.createBindGroup({
      layout: this.labelRenderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.labelBuffer! } },
        { binding: 2, resource: textSampler },
        { binding: 3, resource: this.textAtlas.getTexture()!.createView() }
      ]
    });
  }

  prepareLabelData(visibleNodes: DiagramNode[], viewport: Viewport): LabelInstanceData[] {
    // Collect nodes with labels
    const nodesWithLabels = visibleNodes.filter(node => 
      node.data.label && node.data.label.trim().length > 0
    );

    if (nodesWithLabels.length === 0) {
      return [];
    }

    const labelDataArray: LabelInstanceData[] = [];

    // Prepare all labels and add to atlas
    for (const node of nodesWithLabels) {
      const label = node.data.label!.trim();
      const fontSize = 14;
      const textColor = '#ffffff';

      try {
        // Add text to atlas
        const atlasEntry = this.textAtlas.addText(label, fontSize, textColor);
        if (!atlasEntry) continue; // Atlas full

        // Calculate label size in world coordinates
        const textScale = Math.max(0.5, Math.min(2.0, 1.0 / viewport.zoom));
        const labelWorldWidth = (atlasEntry.width * textScale) / viewport.zoom;
        const labelWorldHeight = (atlasEntry.height * textScale) / viewport.zoom;

        // Position label at the center of the node
        const labelX = node.data.position.x;
        const labelY = node.data.position.y;

        // Calculate UV coordinates in atlas (normalized 0-1)
        const atlasSize = this.textAtlas.getAtlasSize();
        const u1 = atlasEntry.x / atlasSize;
        const v1 = atlasEntry.y / atlasSize;
        const u2 = (atlasEntry.x + atlasEntry.width) / atlasSize;
        const v2 = (atlasEntry.y + atlasEntry.height) / atlasSize;

        labelDataArray.push({
          texCoords: [u1, v1, u2, v2],
          color: [1, 1, 1, 1],
          position: [labelX, labelY],
          size: [labelWorldWidth, labelWorldHeight]
        });

      } catch (error) {
        console.error('Error preparing label:', label, error);
      }
    }

    return labelDataArray;
  }

  render(renderPass: GPURenderPassEncoder, labelData: LabelInstanceData[]): void {
    if (!this.labelRenderPipeline || !this.labelBuffer || labelData.length === 0) {
      return;
    }

    // Update atlas texture on GPU
    this.textAtlas.updateGPUTexture();

    // Prepare batched label data for GPU
    const flatLabelData = new Float32Array(labelData.length * 12); // 12 floats per label
    labelData.forEach((label, i) => {
      const offset = i * 12;
      // Write data in the corrected order
      // texCoords: vec4<f32>
      flatLabelData[offset + 0] = label.texCoords[0];
      flatLabelData[offset + 1] = label.texCoords[1];
      flatLabelData[offset + 2] = label.texCoords[2];
      flatLabelData[offset + 3] = label.texCoords[3];
      // color: vec4<f32>
      flatLabelData[offset + 4] = label.color[0];
      flatLabelData[offset + 5] = label.color[1];
      flatLabelData[offset + 6] = label.color[2];
      flatLabelData[offset + 7] = label.color[3];
      // position: vec2<f32>
      flatLabelData[offset + 8] = label.position[0];
      flatLabelData[offset + 9] = label.position[1];
      // size: vec2<f32>
      flatLabelData[offset + 10] = label.size[0];
      flatLabelData[offset + 11] = label.size[1];
    });

    // Resize label buffer if needed
    const requiredSize = labelData.length * 48; // 12 floats * 4 bytes = 48 bytes per label
    if (requiredSize > this.labelBuffer.size) {
      this.labelBuffer.destroy();
      this.labelBuffer = this.device.createBuffer({
        size: requiredSize * 2, // Double for growth
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // Update bind group with new buffer
      this.updateBindGroup();
    }

    // Upload label data to GPU
    this.device.queue.writeBuffer(this.labelBuffer, 0, flatLabelData);

    // Render all labels in one batch
    renderPass.setPipeline(this.labelRenderPipeline);
    renderPass.setBindGroup(0, this.labelBindGroup!);
    renderPass.draw(6, labelData.length); // Render all labels in one draw call

    console.log(`Rendered ${labelData.length} labels in batch`);
  }

  // Utility methods
  clearAtlas() {
    this.textAtlas.clear();
  }

  getAtlasStats() {
    return this.textAtlas.getStats();
  }

  getDebugCanvas(): HTMLCanvasElement {
    return this.textAtlas.getDebugCanvas();
  }

  destroy() {
    if (this.textAtlas) {
      this.textAtlas.destroy();
    }

    if (this.labelBuffer) {
      this.labelBuffer.destroy();
      this.labelBuffer = null;
    }

    this.labelRenderPipeline = null;
    this.labelBindGroup = null;
  }
}