import { TextureAtlas } from './TextureAtlas';
import type { DiagramNode, Viewport } from '../types';
import { Z_LAYERS } from '../utils/DepthConstants';

export interface LabelInstanceData {
  texCoords: [number, number, number, number]; // UV coordinates in atlas (u1, v1, u2, v2)
  color: [number, number, number, number];     // Text color
  position: [number, number]; // World position
  size: [number, number]; // Label size in world units
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
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
      );

        let label = labelData[instanceIndex];
        let localPos = positions[vertexIndex];
        let uv = uvs[vertexIndex];
        
        // Calculate world position for the label quad
        let worldPos = label.position + localPos * label.size * 0.5;
        
        // Map UV to atlas coordinates
        let atlasUV = mix(label.texCoords.xy, label.texCoords.zw, uv);
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${Z_LAYERS.LABELS} , 1.0);
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
      label: 'label-render-pipeline',

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
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, 
        depthCompare: 'less',
      }
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

private hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
    const cleanHex = hex.replace('#', '');
    
    if (cleanHex.length === 8) {
      return {
        r: parseInt(cleanHex.substring(0, 2), 16) / 255,
        g: parseInt(cleanHex.substring(2, 4), 16) / 255,
        b: parseInt(cleanHex.substring(4, 6), 16) / 255,
        a: parseInt(cleanHex.substring(6, 8), 16) / 255,
      };
    } else if (cleanHex.length === 6) {
      return {
        r: parseInt(cleanHex.substring(0, 2), 16) / 255,
        g: parseInt(cleanHex.substring(2, 4), 16) / 255,
        b: parseInt(cleanHex.substring(4, 6), 16) / 255,
        a: 1.0,
      };
    } else {
      return { r: 0.23, g: 0.51, b: 0.96, a: 1.0 };
    }
  }

prepareLabelData(visibleNodes: DiagramNode[], viewport: Viewport): LabelInstanceData[] {
  const nodesWithLabels = visibleNodes.filter(node => 
    node.data.label && node.data.label.trim().length > 0
  );

  if (nodesWithLabels.length === 0) {
    return [];
  }

  const labelDataArray: LabelInstanceData[] = [];

  for (const node of nodesWithLabels) {
    const label = node.data.label!.trim();
    const fontSize = 244;
    const textColor = '#ffffffff';

    try {
      const atlasEntry = this.textAtlas.addText(label, fontSize, textColor);
      if (!atlasEntry) continue;
      const textScale = Math.min(0.5, Math.min(2.0, 1.0 / viewport.zoom)) * 0.1;

      
      const labelWorldWidth = (atlasEntry.width * textScale) / viewport.zoom;
      const labelWorldHeight = (atlasEntry.height * textScale) / viewport.zoom;

      // Position at node center
      const labelX = node.data.position.x;
      const labelY = node.data.position.y;

      // FIX: Ensure UV coordinates are properly normalized
      const atlasSize = this.textAtlas.getAtlasSize();
      const u1 = atlasEntry.x / atlasSize;
      const v1 = atlasEntry.y / atlasSize;
      const u2 = (atlasEntry.x + atlasEntry.width) / atlasSize;
      const v2 = (atlasEntry.y + atlasEntry.height) / atlasSize;

      const textColorRGBA = this.hexToRgba(textColor);

      console.log('Label entry:', {
        text: label,
        position: [labelX, labelY],
        size: [labelWorldWidth, labelWorldHeight],
        uv: [u1, v1, u2, v2],
        atlasEntry: { x: atlasEntry.x, y: atlasEntry.y, w: atlasEntry.width, h: atlasEntry.height }
      });

      labelDataArray.push({
        texCoords: [u1, v1, u2, v2],
        color: [textColorRGBA.r, textColorRGBA.g, textColorRGBA.b, textColorRGBA.a],
        position: [labelX, labelY],
        size: [labelWorldWidth, labelWorldHeight]
      });

    } catch (error) {
      console.error('Error preparing label:', label, error);
    }
  }

  console.log(`Prepared ${labelDataArray.length} labels for rendering`);
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
