import type { DiagramNode, Viewport } from '../types';
import { VisualContentAtlas } from './VisualContentAtlas';

export interface VisualInstanceData {
  texCoords: [number, number, number, number]; // UV coordinates in atlas (u1, v1, u2, v2)
  color: [number, number, number, number];     // Tint color (white = no tint)
  position: [number, number];                  // World position
  size: [number, number];                      // Visual size in world units
}

export class VisualContentRenderer {
  private device: GPUDevice;
  private visualAtlas: VisualContentAtlas;
  private visualRenderPipeline: GPURenderPipeline | null = null;
  private visualBindGroup: GPUBindGroup | null = null;
  private visualBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer;
  
  constructor(device: GPUDevice, uniformBuffer: GPUBuffer) {
    this.device = device;
    this.uniformBuffer = uniformBuffer;
    this.visualAtlas = new VisualContentAtlas(device);
  }

  async initialize(): Promise<void> {
    await this.setupVisualRenderPipeline();
    console.log('VisualContentRenderer initialized successfully');
  }

  private async setupVisualRenderPipeline() {
    // Visual content buffer for batched visual data
    this.visualBuffer = this.device.createBuffer({
      size: 1000 * 64, // Same as label renderer - 16 floats * 4 bytes = 64 bytes per visual
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Visual content shader - very similar to label shader
    const visualShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
      }

      struct VisualData {
        @align(16) texCoords: vec4<f32>, 
        @align(16) color: vec4<f32>,
        @align(8) position: vec2<f32>,
        @align(8) size: vec2<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> visualData: array<VisualData>;
      @group(0) @binding(2) var visualSampler: sampler;
      @group(0) @binding(3) var visualAtlas: texture_2d<f32>;

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

        let visual = visualData[instanceIndex];
        let localPos = positions[vertexIndex];
        let uv = uvs[vertexIndex];
        
        let worldPos = visual.position + localPos * visual.size * 0.5;

        let atlasUV = mix(visual.texCoords.xy, visual.texCoords.zw, uv);
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos, 0.005, 1.0);
        output.uv = atlasUV;
        output.color = visual.color;
        
        return output;
      }

      @fragment
      fn fs_main(
        @location(0) uv: vec2<f32>,
        @location(1) color: vec4<f32>
      ) -> @location(0) vec4<f32> {
        let visualSample = textureSample(visualAtlas, visualSampler, uv);
        
        let sampledColor = visualSample * color;
        
        if (sampledColor.a < 0.01) {
          discard;
        }
        
        return sampledColor;
      }
    `;

    const visualShaderModule = this.device.createShaderModule({ code: visualShaderCode });

    // Create bind group layout
    const visualBindGroupLayout = this.device.createBindGroupLayout({
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

    // Create render pipeline
    const visualPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [visualBindGroupLayout]
    });

    this.visualRenderPipeline = this.device.createRenderPipeline({
      layout: visualPipelineLayout,
      vertex: {
        module: visualShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: visualShaderModule,
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

    // Create initial bind group
    this.updateBindGroup();
  }

  private updateBindGroup() {
    if (!this.visualRenderPipeline || !this.visualAtlas.getTexture()) return;

    const visualSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.visualBindGroup = this.device.createBindGroup({
      layout: this.visualRenderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.visualBuffer! } },
        { binding: 2, resource: visualSampler },
        { binding: 3, resource: this.visualAtlas.getTexture()!.createView() }
      ]
    });
  }

  destroy() {
    this.visualAtlas.destroy();
  }

  prepareVisualData(visibleNodes: DiagramNode[], viewport: Viewport): VisualInstanceData[] {
    // Filter nodes that have visual content
    const nodesWithVisuals = visibleNodes.filter(node => 
      node.visual?.visualContent && node.visual.visualContent.content
    );

    if (nodesWithVisuals.length === 0) {
      return [];
    }

    const visualDataArray: VisualInstanceData[] = [];

    // Process each node with visual content
    for (const node of nodesWithVisuals) {
      const icon = node.visual?.visualContent!;
      
      try {
        let atlasEntry = null;
        
        // Add content to atlas based on type
        switch (icon.type) {
          case 'image':
            atlasEntry = this.visualAtlas.addImage(icon.content, icon.size || {width: 64, height: 64});
            break;
          case 'svg':
            atlasEntry = this.visualAtlas.addSVG(icon.content, icon.size.width || 64, icon.size.height || 64);
            break;
          case 'emoji':
            atlasEntry = this.visualAtlas.addEmoji(icon.content, icon.size || 64);
            break;
          default:
            console.warn('Unknown visual content type:', icon.type);
            continue;
        }
        
        if (!atlasEntry) {
          console.warn('Failed to add visual content to atlas:', icon.content);
          continue;
        }

        // Calculate visual size in world coordinates

        const iconSize = icon.size || {width: 64, height: 64};
        const visualScale = Math.max(0.3, Math.min(1.5, 1.0 / viewport.zoom));
        const visualWorldWidth = (iconSize.width * visualScale) / viewport.zoom;
        const visualWorldHeight = (iconSize.height * visualScale) / viewport.zoom;

        // Position visual content relative to node
        const nodeSize = node.data.size || { width: 100, height: 60 };
        const visualX = node.data.position.x;
        const visualY = node.data.position.y - nodeSize.height/2 - visualWorldHeight/2 - 10; // Above node

        // Calculate UV coordinates in atlas
        const atlasSize = this.visualAtlas.getAtlasSize();
        const u1 = atlasEntry.x / atlasSize;
        const v1 = atlasEntry.y / atlasSize;
        const u2 = (atlasEntry.x + atlasEntry.width) / atlasSize;
        const v2 = (atlasEntry.y + atlasEntry.height) / atlasSize;

        visualDataArray.push({
          texCoords: [u1, v1, u2, v2],
          color: [1, 1, 1, 1], 
          position: [visualX, visualY],
          size: [visualWorldWidth, visualWorldHeight]
        });

        console.log(`Added visual: ${icon.type} at (${visualX}, ${visualY})`);

      } catch (error) {
        console.error('Error preparing visual content:', icon.content, error);
      }
    }

    return visualDataArray;
  }
   render(renderPass: GPURenderPassEncoder, visualData: VisualInstanceData[]): void {
    if (!this.visualRenderPipeline || !this.visualBuffer || visualData.length === 0) {
      return;
    }

    // Update atlas texture on GPU
    this.visualAtlas.updateGPUTexture();

    // Update bind group if needed
    this.updateBindGroup();

    // Prepare batched visual data for GPU (same format as labels)
    const flatVisualData = new Float32Array(visualData.length * 16); // 16 floats per visual for alignment
    visualData.forEach((visual, i) => {
      const offset = i * 16;
      // texCoords: vec4<f32>
      flatVisualData[offset + 0] = visual.texCoords[0];
      flatVisualData[offset + 1] = visual.texCoords[1];
      flatVisualData[offset + 2] = visual.texCoords[2];
      flatVisualData[offset + 3] = visual.texCoords[3];
      // color: vec4<f32>
      flatVisualData[offset + 4] = visual.color[0];
      flatVisualData[offset + 5] = visual.color[1];
      flatVisualData[offset + 6] = visual.color[2];
      flatVisualData[offset + 7] = visual.color[3];
      // position: vec2<f32> + padding
      flatVisualData[offset + 8] = visual.position[0];
      flatVisualData[offset + 9] = visual.position[1];
      flatVisualData[offset + 10] = 0; // padding
      flatVisualData[offset + 11] = 0; // padding
      // size: vec2<f32> + padding
      flatVisualData[offset + 12] = visual.size[0];
      flatVisualData[offset + 13] = visual.size[1];
      flatVisualData[offset + 14] = 0; // padding
      flatVisualData[offset + 15] = 0; // padding
    });

    // Resize buffer if needed
    const requiredSize = visualData.length * 64; // 16 floats * 4 bytes = 64 bytes per visual
    if (requiredSize > this.visualBuffer.size) {
      this.visualBuffer.destroy();
      this.visualBuffer = this.device.createBuffer({
        size: requiredSize * 2, // Double for growth
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.updateBindGroup();
    }

    // Upload visual data to GPU
    this.device.queue.writeBuffer(this.visualBuffer, 0, flatVisualData);

    // Render all visuals in one batch
    try {
    renderPass.setPipeline(this.visualRenderPipeline);
    renderPass.setBindGroup(0, this.visualBindGroup!);
    renderPass.draw(6, visualData.length);
    }
    catch (e) {
      console.log('Something went bad with the render ):', e)
    }

    console.log(`Rendered ${visualData.length} visual elements in batch`);
  }

}