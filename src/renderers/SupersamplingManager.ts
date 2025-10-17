export default class SupersamplingManager {
  private device: GPUDevice;
  private supersamplingFactor: number = 1;
  private supersampledTexture: GPUTexture | null = null;
  private supersampledResolveTexture: GPUTexture | null = null; // For MSAA resolve
  private supersampledDepthTexture: GPUTexture | null = null;
  private downsamplePipeline: GPURenderPipeline | null = null;
  private downsampleBindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler | null = null;
  private sampleCount: string | null = null;

  constructor(device: GPUDevice, sampleCount: string) {
    this.sampleCount = sampleCount;
    this.device = device;
    this.createDownsamplePipeline(this.sampleCount);
  }

  private createDownsamplePipeline(sampleCount: string) {
    this.sampleCount = sampleCount;

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    const downsampleShader = `
      @group(0) @binding(0) var supersampledTexture: texture_2d<f32>;
      @group(0) @binding(1) var textureSampler: sampler;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      }

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        let positions = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        
      let uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
      );

        var output: VertexOutput;
        output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
        output.uv = uvs[vertexIndex];
        return output;
      }

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        // High-quality downsampling with linear filtering
        return textureSample(supersampledTexture, textureSampler, input.uv);
      }
    `;

    const shaderModule = this.device.createShaderModule({
      code: downsampleShader,
      label: 'downsample-shader'
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        }
      ]
    });

    this.downsamplePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat(),
        }]
      },
      primitive: {
        topology: 'triangle-list'
      },
      // No multisample for downsample pipeline - it renders to canvas directly
    });
  }

  setSupersamplingFactor(factor: number) {
    const validFactors = [1, 2, 4, 8];
    if (!validFactors.includes(factor)) {
      console.warn(`Invalid supersampling factor ${factor}, using 1`);
      factor = 1;
    }
    
    if (this.supersamplingFactor !== factor) {
      console.log(`Supersampling factor changed: ${this.supersamplingFactor}x → ${factor}x`);
      this.supersamplingFactor = factor;
    }
  }

  getSupersamplingFactor(): number {
    return this.supersamplingFactor;
  }

  createSupersampledTextures(
    width: number, 
    height: number, 
    sampleCount: number,
    format: GPUTextureFormat = 'bgra8unorm'
  ) {
    // Destroy old textures
    if (this.supersampledTexture) {
      this.supersampledTexture.destroy();
    }
    if (this.supersampledResolveTexture) {
      this.supersampledResolveTexture.destroy();
    }
    if (this.supersampledDepthTexture) {
      this.supersampledDepthTexture.destroy();
    }

    const supersampledWidth = width * this.supersamplingFactor;
    const supersampledHeight = height * this.supersamplingFactor;

    console.log(`Creating supersampled textures: ${supersampledWidth}x${supersampledHeight} (${this.supersamplingFactor}x) with ${sampleCount}x MSAA`);

    if (sampleCount > 1) {
      this.supersampledTexture = this.device.createTexture({
        size: { width: supersampledWidth, height: supersampledHeight },
        format: format,
        sampleCount: sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        label: `supersampled-msaa-${this.supersamplingFactor}x-${sampleCount}xMSAA`
      });
      
      this.supersampledResolveTexture = this.device.createTexture({
        size: { width: supersampledWidth, height: supersampledHeight },
        format: format,
        sampleCount: 1,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: `supersampled-resolve-${this.supersamplingFactor}x`
      });
    } else {
      // Without MSAA: single texture
      this.supersampledTexture = this.device.createTexture({
        size: { width: supersampledWidth, height: supersampledHeight },
        format: format,
        sampleCount: 1,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        label: `supersampled-color-${this.supersamplingFactor}x`
      });
      this.supersampledResolveTexture = null;
    }

    // Create depth texture
    this.supersampledDepthTexture = this.device.createTexture({
      size: { width: supersampledWidth, height: supersampledHeight },
      format: 'depth24plus',
      sampleCount: sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: `supersampled-depth-${this.supersamplingFactor}x-${sampleCount}xMSAA`
    });

    // Create bind group for downsampling
    // We downsample from the resolve texture (or main texture if no MSAA)
    if (this.downsamplePipeline) {
      const textureToSample = this.supersampledResolveTexture || this.supersampledTexture;
      this.downsampleBindGroup = this.device.createBindGroup({
        layout: this.downsamplePipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: textureToSample.createView()
          },
          {
            binding: 1,
            resource: this.sampler!
          }
        ]
      });
    }
  }

  getSupersampledTextures() {
    return {
      colorTexture: this.supersampledTexture,
      resolveTexture: this.supersampledResolveTexture,
      depthTexture: this.supersampledDepthTexture
    };
  }

  updateSampleCount(sampleCount: string) {
    this.sampleCount = sampleCount;
    this.createDownsamplePipeline(sampleCount);
  }

  getSupersampledDimensions(baseWidth: number, baseHeight: number) {
    return {
      width: baseWidth * this.supersamplingFactor,
      height: baseHeight * this.supersamplingFactor
    };
  }

downsample(commandEncoder: GPUCommandEncoder, targetTexture: GPUTexture) {
  if (!this.downsamplePipeline) {
    console.warn('Downsample pipeline not ready');
    return;
  }
  
  const sourceTexture = this.supersampledResolveTexture || this.supersampledTexture;
  if (!sourceTexture) {
    console.warn('No source texture for downsampling');
    return;
  }
  
  // ALWAYS recreate bind group to ensure correct texture reference
  this.downsampleBindGroup = this.device.createBindGroup({
    layout: this.downsamplePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: sourceTexture.createView()
      },
      {
        binding: 1,
        resource: this.sampler!
      }
    ]
  });

  const renderPass = commandEncoder.beginRenderPass({
    label: 'downsample-pass',
    colorAttachments: [{
      view: targetTexture.createView(),
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0.15, g: 0.15, b: 0.15, a: 1.0 }
    }]
  });

  renderPass.setPipeline(this.downsamplePipeline);
  renderPass.setBindGroup(0, this.downsampleBindGroup);
  renderPass.draw(6);
  renderPass.end();
}

  isEnabled(): boolean {
    return this.supersamplingFactor > 1;
  }

  destroy() {
    if (this.supersampledTexture) {
      this.supersampledTexture.destroy();
      this.supersampledTexture = null;
    }
    if (this.supersampledResolveTexture) {
      this.supersampledResolveTexture.destroy();
      this.supersampledResolveTexture = null;
    }
    if (this.supersampledDepthTexture) {
      this.supersampledDepthTexture.destroy();
      this.supersampledDepthTexture = null;
    }
  }
}