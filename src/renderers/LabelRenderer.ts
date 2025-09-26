import { SDFTextAtlas } from './SDFTextAtlas';
import type { DiagramNode } from '../types';
import { Z_LAYERS } from '../utils/DepthConstants';

export interface SDFLabelInstanceData {
  position: [number, number];
  size: [number, number];
  texCoords: [number, number, number, number];  // u1, v1, u2, v2
  color: [number, number, number, number];       // r, g, b, a
}

export class LabelRenderer {
  private device: GPUDevice;
  private sdfAtlas: SDFTextAtlas;
  private renderPipeline: GPURenderPipeline | undefined;
  private uniformBuffer: GPUBuffer | undefined;
  private instanceBuffer: GPUBuffer | undefined;
  private bindGroup: GPUBindGroup | undefined;
  private sampler: GPUSampler | undefined;
  
  private maxInstances = 1000;
  
  constructor(device: GPUDevice, format: GPUTextureFormat = 'bgra8unorm') {
    this.device = device;
    this.sdfAtlas = new SDFTextAtlas(device, 132, 3); // 32px base font, 8px buffer
    
    this.createBuffers();
    this.createSampler();
    this.createPipeline(format);
    this.createBindGroup();
  }
  
  private createBuffers() {
    // Uniform buffer for view-projection matrix
    this.uniformBuffer = this.device.createBuffer({
      size: 64, // 4x4 matrix = 16 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'sdf-label-uniforms'
    });
    
    // Instance buffer for label data
    this.instanceBuffer = this.device.createBuffer({
      size: this.maxInstances * 48, // 12 floats * 4 bytes per instance
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'sdf-label-instances'
    });
  }
  
  private createSampler() {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }
  
  private createPipeline(format: GPUTextureFormat) {
    const shaderModule = this.device.createShaderModule({
      code: `
        // [Insert the shader code from the previous artifact here]
        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) uv: vec2<f32>,
          @location(1) color: vec4<f32>,
        }
        
        struct Uniforms {
          viewProjection: mat4x4<f32>,
        }
        
        struct LabelInstance {
          @location(0) position: vec2<f32>,
          @location(1) size: vec2<f32>,
          @location(2) texCoords: vec4<f32>,
          @location(3) color: vec4<f32>,
        }
        
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var atlasTexture: texture_2d<f32>;
        @group(0) @binding(2) var atlasSampler: sampler;
        
        @vertex
        fn vs_main(
          @builtin(vertex_index) vertexIndex: u32,
          instance: LabelInstance
        ) -> VertexOutput {
          let positions = array<vec2<f32>, 6>(
            vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(-0.5, 0.5),
            vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, 0.5)
          );
          
          let uvs = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
          );
        
          let localPos = positions[vertexIndex];
          let uv = uvs[vertexIndex];
          
          let worldPos = instance.position + localPos * instance.size;
          
          var output: VertexOutput;
          output.position = uniforms.viewProjection * vec4<f32>(worldPos, ${Z_LAYERS.LABELS}, 1.0);
          output.uv = mix(instance.texCoords.xy, instance.texCoords.zw, uv);
          output.color = instance.color;
          
          return output;
        }
        
        @fragment  
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          // Sample the SDF distance from red channel
          let sdfSample = textureSample(atlasTexture, atlasSampler, input.uv);
          let rawDistance = sdfSample.r; // This is 0-1 range from our 0-255 SDF data
          
          // Convert back to original SDF range (0-255) and normalize around 128 (edge)
          let sdfValue = rawDistance * 255.0;
          let sdf = (sdfValue - 128.0) / 128.0; // Now -1 to ~0.74, with 0 being the edge
          
          // Calculate anti-aliasing
          let smoothing = fwidth(sdf);
          
          // Create smooth edge: alpha = 0 when sdf < 0, alpha = 1 when sdf > 0
          let alpha = smoothstep(-smoothing, smoothing, sdf);
          
          // Apply text color with calculated alpha
          return vec4<f32>(input.color.rgb, input.color.a * alpha);
        }
      `,
      label: 'sdf-label-shader'
    });
    
    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 48, 
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },   // position
            { shaderLocation: 1, offset: 8, format: 'float32x2' },   // size
            { shaderLocation: 2, offset: 16, format: 'float32x4' },  // texCoords
            { shaderLocation: 3, offset: 32, format: 'float32x4' },  // color
          ]
        }]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, 
        depthCompare: 'less',
      }
    });
  }
  
  private createBindGroup() {
    this.bindGroup = this.device.createBindGroup({
      layout: this.renderPipeline!.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer! }
        },
        {
          binding: 1,
          resource: this.sdfAtlas.getTexture().createView()
        },
        {
          binding: 2,
          resource: this.sampler!
        }
      ],
      label: 'sdf-label-bind-group'
    });
  }
  
   
  prepareLabelData(visibleNodes: DiagramNode[]): SDFLabelInstanceData[] {

    const labelDataArray: SDFLabelInstanceData[] = [];
    
    const nodesWithLabels = visibleNodes.filter(node => 
      node.data.label && node.data.label.trim().length > 0
    );
    
    if (nodesWithLabels.length === 0) return labelDataArray;
    
    const atlasSize = this.sdfAtlas.getAtlasSize();
    
    for (const node of nodesWithLabels) {
      const label = node.data.label!.trim();
     
      
      try {
        const layoutedGlyphs = this.sdfAtlas.layoutText(label);
        if (layoutedGlyphs.length === 0) continue; 
        const nodeSize = Math.max(node.visual?.size?.width || 100, node.visual?.size?.height || 100);
        const referenceSize = 100; 
        const scale = Math.sqrt(nodeSize / referenceSize) * 0.1; 
        let baseX = node.data.position.x;
        const baseY = node.data.position.y;
        
        let totalWidth = 0;
        for (const glyph of layoutedGlyphs) {
          totalWidth += glyph.atlasEntry.glyphAdvance * scale;
        }
        
        let currentX = baseX - totalWidth / 2; 
        
        for (const glyph of layoutedGlyphs) {
          const atlasEntry = glyph.atlasEntry;
          
          const u1 = atlasEntry.x / atlasSize.width;
          const u2 = (atlasEntry.x + atlasEntry.width) / atlasSize.width;
          const v2 = atlasEntry.y / atlasSize.height;
          const v1 = (atlasEntry.y + atlasEntry.height) / atlasSize.height;
          
          const glyphAdvance = atlasEntry.glyphAdvance * scale;
          const glyphWorldWidth = atlasEntry.width * scale;
          const glyphWorldHeight = atlasEntry.height * scale;
          

          const glyphX = currentX + glyphAdvance / 2; 
          const glyphY = baseY - (atlasEntry.glyphTop * scale) + glyphWorldHeight / 2;
          
          labelDataArray.push({
            position: [glyphX, glyphY],
            size: [glyphWorldWidth, glyphWorldHeight],
            texCoords: [u1, v1, u2, v2],
            color: [1, 1, 1, 1]
          });
          
          currentX += atlasEntry.glyphAdvance * scale;
        }
        
      } catch (error) {
        console.error('Error preparing SDF label:', label, error);
      }
    }
    
    return labelDataArray;
  }
  
  render(renderPass: GPURenderPassEncoder, viewProjectionMatrix: number[] | Float32Array, visibleNodes: DiagramNode[]) {
    const labelData = this.prepareLabelData(visibleNodes);
    
    if (labelData.length === 0) return;
    

    const matrixData = new Float32Array(viewProjectionMatrix);
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, matrixData);
    
    const instanceData = new Float32Array(labelData.length * 12);
    for (let i = 0; i < labelData.length; i++) {
      const label = labelData[i];
      const offset = i * 12;
      
      instanceData[offset + 0] = label.position[0];
      instanceData[offset + 1] = label.position[1];
      instanceData[offset + 2] = label.size[0];
      instanceData[offset + 3] = label.size[1];
      instanceData[offset + 4] = label.texCoords[0];
      instanceData[offset + 5] = label.texCoords[1];
      instanceData[offset + 6] = label.texCoords[2];
      instanceData[offset + 7] = label.texCoords[3];
      instanceData[offset + 8] = label.color[0];
      instanceData[offset + 9] = label.color[1];
      instanceData[offset + 10] = label.color[2];
      instanceData[offset + 11] = label.color[3];
    }
    
    const buffer = new ArrayBuffer(instanceData.byteLength);
    new Float32Array(buffer).set(instanceData);
    this.device.queue.writeBuffer(this.instanceBuffer!, 0, buffer);
    renderPass.setPipeline(this.renderPipeline!);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.instanceBuffer);
    renderPass.draw(6, labelData.length); 
  }
  
  debugAtlas() {
    this.sdfAtlas.debugTestAtlas();
    this.sdfAtlas.debugSaveAtlas();
  }

  clearAtlas() {
     this.sdfAtlas.clear();
  }
  
  destroy() {
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.sdfAtlas.destroy();
  }
}