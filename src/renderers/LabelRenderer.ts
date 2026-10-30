import { TextureAtlas } from './TextureAtlas';
import type { DiagramEdge, DiagramNode, Viewport } from '../types';
import { Z_LAYERS } from '../utils/DepthConstants';
import type { DiagramFont } from '../utils/FontLoadUtils';
import { declutter, labelWorldScale, LABEL_ATLAS_FONT_SIZE, type LabelCandidate } from './LabelScaling';

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
  private sampleCount: string;
  
  constructor(device: GPUDevice, uniformBuffer: GPUBuffer, sampleCount = '1') {
    this.device = device;
    this.uniformBuffer = uniformBuffer;
    this.textAtlas = new TextureAtlas(device);
    this.sampleCount = sampleCount;
  }

  async initialize(): Promise<boolean> {
    try {
    await this.setupLabelRenderPipeline();
    }
    catch (e) {
      return false;
    }
    console.log('LabelRenderer initialized successfully');
    return true;
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
          if (textSample.a < 0.01) {
            discard;
          }
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
        // Labels share one z and are drawn last; writing depth would let one label's
        // anti-aliased fringe clip any label it overlaps.
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample: {count: parseInt(this.sampleCount)}
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

prepareLabelData(visibleNodes: DiagramNode[], visibleEdges: DiagramEdge[], viewport: Viewport): LabelInstanceData[] {
  const zoom = viewport.zoom;
  const pixelRatio = viewport.pixelRatio ?? 1;
  const scale = labelWorldScale(zoom, pixelRatio);
  const atlasSize = this.textAtlas.getAtlasSize();

  const degree = new Map<string, number>();
  for (const edge of visibleEdges) {
    degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
    degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const nodesById = new Map(visibleNodes.map(n => [n.id, n]));

  const candidates: LabelCandidate[] = [];
  const instances = new Map<string, LabelInstanceData>();

  const add = (id: string, priority: number, text: string, color: string, fontFamily: DiagramFont, x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try {
      const entry = this.textAtlas.addText(text, LABEL_ATLAS_FONT_SIZE, color, fontFamily);
      if (!entry) return;
      const width = entry.width * scale;
      const height = entry.height * scale;
      const rgba = this.hexToRgba(color);
      candidates.push({ id, priority, x, y, width, height });
      instances.set(id, {
        texCoords: [entry.x / atlasSize, entry.y / atlasSize, (entry.x + entry.width) / atlasSize, (entry.y + entry.height) / atlasSize],
        color: [rgba.r, rgba.g, rgba.b, rgba.a],
        position: [x, y],
        size: [width, height],
      });
    } catch (error) {
      console.error('Error preparing label:', text, error);
    }
  };

  for (const node of visibleNodes) {
    const label = node.data.label?.trim();
    if (!label) continue;
    // Selected nodes always win; otherwise well-connected nodes are the ones worth naming.
    const priority = (node.visual?.selected ? 1e6 : 0) + (degree.get(node.id) ?? 0);
    add(`n:${node.id}`, priority, label, node.visual?.labelColor || '#ffffffff', (node.visual?.labelFont || 'Arial') as DiagramFont,
      node.data.position.x, node.data.position.y);
  }

  for (const edge of visibleEdges) {
    const label = edge.data?.label?.trim();
    if (!label) continue;
    let x: number, y: number;
    if (edge.userVertices.length > 0) {
      const mid = edge.userVertices[Math.floor(edge.userVertices.length / 2)];
      x = mid.x; y = mid.y;
    } else {
      const source = nodesById.get(edge.sourceNodeId), target = nodesById.get(edge.targetNodeId);
      if (!source || !target) continue;
      x = (source.data.position.x + target.data.position.x) / 2;
      y = (source.data.position.y + target.data.position.y) / 2;
    }
    // Below every node label, so edge labels only appear where there's room.
    add(`e:${edge.id}`, -1, label, edge.style.labelColor || '#ffffff', 'Arial', x, y);
  }

  const keep = declutter(candidates, zoom, 4 * pixelRatio);
  return candidates.filter(c => keep.has(c.id)).map(c => instances.get(c.id)!);
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
