import type { DiagramNode } from '../types';
import { VisualContentAtlas } from './VisualContentAtlas';
import { Z_LAYERS } from '../utils/DepthConstants';

export interface VisualInstanceData {
  texCoords: [number, number, number, number];
  color: [number, number, number, number];
  position: [number, number];
  size: [number, number];
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
    console.log('🎨 VisualContentRenderer.initialize() called');
    await this.setupVisualRenderPipeline();
    console.log('🎨 VisualContentRenderer initialized successfully');
  }

  private async setupVisualRenderPipeline() {
    this.visualBuffer = this.device.createBuffer({
      size: 1000 * 48,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const visualShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>,
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
          vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
        );

        let visual = visualData[instanceIndex];
        let localPos = positions[vertexIndex];
        let uv = uvs[vertexIndex];
        
        let worldPos = visual.position + localPos * visual.size * 0.7;
        let atlasUV = mix(visual.texCoords.xy, visual.texCoords.zw, uv);
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${Z_LAYERS.VISUALS}, 1.0);
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
        let finalColor = visualSample * color;
        
        
        if (finalColor.a < 0.01) {
          discard;
        }
        
        return finalColor;
      }
    `;

    const visualShaderModule = this.device.createShaderModule({ code: visualShaderCode });

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

    const visualPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [visualBindGroupLayout]
    });

    this.visualRenderPipeline = this.device.createRenderPipeline({
      label: 'visual-render-pipeline',
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
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less', 
      }

    });

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

  prepareVisualData(visibleNodes: DiagramNode[]): VisualInstanceData[] {
    console.log('🎨 prepareVisualData called with', visibleNodes.length, 'nodes');
    
    const nodesWithVisuals = visibleNodes.filter(node => 
      node.visual?.visualContent || 
      node.visual?.icon || 
      node.data?.emoji || 
      node.data?.icon
    );

    console.log('🎨 Nodes with visuals found:', nodesWithVisuals.length);

    if (nodesWithVisuals.length === 0) {
      console.log('🎨 No nodes with visual content found');
      return [];
    }

    const visualDataArray: VisualInstanceData[] = [];

    for (const node of nodesWithVisuals) {
      console.log('🎨 Processing node:', node.id, node);
      try {
        let atlasEntry = null;
        let iconSize = 64;
        
        let content = '';
        let type = 'emoji';
        
        if (node.visual?.visualContent) {
          content = node.visual.visualContent.content;
          type = node.visual.visualContent.type;
          iconSize = node.visual.visualContent.size?.width || 64;
          console.log('🎨 Using visualContent:', content, type);
        } else if (node.visual?.icon) {
          content = node.visual.icon;
          type = 'emoji';
          console.log('🎨 Using visual.icon:', content);
        } else if (node.data?.emoji) {
          content = node.data.emoji;
          type = 'emoji';
          console.log('🎨 Using data.emoji:', content);
        } else if (node.data?.icon) {
          content = node.data.icon;
          type = 'emoji';
          console.log('🎨 Using data.icon:', content);
        }

        if (!content) {
          console.log('🎨 No content found for node:', node.id);
          continue;
        }

        if (type === 'emoji' || content.length <= 2) {
          atlasEntry = this.visualAtlas.addEmoji(content, iconSize);
        } else {
          const color = node.visual?.color || '#3b82f6';
          atlasEntry = this.visualAtlas.addColoredShape('circle', color, iconSize);
        }
        
        if (!atlasEntry) {
          console.warn('🎨 Failed to add visual content to atlas:', content);
          continue;
        }

        // Make visuals much larger and more visible
        const visualScale = 0.5; // Fixed large scale
        const visualWorldWidth = iconSize * visualScale;
        const visualWorldHeight = iconSize * visualScale;

        const visualX = node.data.position.x;
        const visualY = node.data.position.y;

        const atlasSize = this.visualAtlas.getAtlasSize();
        const u1 = atlasEntry.x / atlasSize;
        const u2 = (atlasEntry.x + atlasEntry.width) / atlasSize;
        const v1 = (atlasEntry.y + atlasEntry.height) / atlasSize;  // Flip V
        const v2 = atlasEntry.y / atlasSize;                        // Flip V

        visualDataArray.push({
          texCoords: [u1, v1, u2, v2],
          color: [1, 1, 1, 1],
          position: [visualX, visualY],
          size: [visualWorldWidth, visualWorldHeight]
        });

        console.log(`🎨 Added visual: ${type}:"${content}" at (${visualX}, ${visualY}) size:(${visualWorldWidth}, ${visualWorldHeight}) UV:(${u1}, ${v1}, ${u2}, ${v2})`);

      } catch (error) {
        console.error('🎨 Error preparing visual content:', error);
      }
    }

    console.log(`🎨 Final visual data array:`, visualDataArray);
    console.log(`🎨 Prepared ${visualDataArray.length} visuals for rendering`);
    return visualDataArray;
  }

  render(renderPass: GPURenderPassEncoder, visualData: VisualInstanceData[]): void {
    console.log(`🎨 render() called with ${visualData.length} visual items`);
    
    if (!this.visualRenderPipeline || !this.visualBuffer || visualData.length === 0) {
      console.log('🎨 Skipping render - missing pipeline or buffer or no data');
      return;
    }

    this.visualAtlas.updateGPUTexture();
    this.updateBindGroup();

    console.log('🎨 First visual item debug:', visualData[0]);

    const flatVisualData = new Float32Array(visualData.length * 12);
    visualData.forEach((visual, i) => {
      const offset = i * 12;
      flatVisualData[offset + 0] = visual.texCoords[0];
      flatVisualData[offset + 1] = visual.texCoords[1];
      flatVisualData[offset + 2] = visual.texCoords[2];
      flatVisualData[offset + 3] = visual.texCoords[3];
      flatVisualData[offset + 4] = visual.color[0];
      flatVisualData[offset + 5] = visual.color[1];
      flatVisualData[offset + 6] = visual.color[2];
      flatVisualData[offset + 7] = visual.color[3];
      flatVisualData[offset + 8] = visual.position[0];
      flatVisualData[offset + 9] = visual.position[1];
      flatVisualData[offset + 10] = visual.size[0];
      flatVisualData[offset + 11] = visual.size[1];
    });

    const requiredSize = visualData.length * 48;
    if (requiredSize > this.visualBuffer.size) {
      this.visualBuffer.destroy();
      this.visualBuffer = this.device.createBuffer({
        size: requiredSize * 2,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.updateBindGroup();
    }

    this.device.queue.writeBuffer(this.visualBuffer, 0, flatVisualData);

    renderPass.setPipeline(this.visualRenderPipeline);
    renderPass.setBindGroup(0, this.visualBindGroup!);
    renderPass.draw(6, visualData.length);

    console.log(`🎨 Rendered ${visualData.length} visual elements in batch`);
  }

  clearAtlas(): void {
    this.visualAtlas.clear();
  }

  getAtlasStats() {
    return this.visualAtlas.getStats();
  }

  getDebugCanvas(): HTMLCanvasElement {
    return this.visualAtlas.getDebugCanvas();
  }

  // DEBUG: Add this method to check the atlas
  debugShowAtlas(): void {
    const canvas = this.visualAtlas.getDebugCanvas();
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.body.appendChild(canvas.cloneNode(true));
      newWindow.document.title = 'Visual Atlas Debug';
    }
  }

  destroy() {
    if (this.visualAtlas) {
      this.visualAtlas.destroy();
    }

    if (this.visualBuffer) {
      this.visualBuffer.destroy();
      this.visualBuffer = null;
    }

    this.visualRenderPipeline = null;
    this.visualBindGroup = null;
  }
}