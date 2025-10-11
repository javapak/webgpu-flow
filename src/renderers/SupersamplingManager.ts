export default class SupersamplingManager {
  private device: GPUDevice;
  private supersamplingFactor: number = 1;
  private supersampledTexture: GPUTexture | null = null;
  private supersampledDepthTexture: GPUTexture | null = null;
  private downsamplePipeline: GPURenderPipeline | null = null;
  private downsampleBindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.createDownsamplePipeline();
  }

  private createDownsamplePipeline() {
    // Create high-quality sampler for downsampling
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
        // Full-screen quad
        let positions = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        
        let uvs = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
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
      }
    });
  }

  setSupersamplingFactor(factor: number) {
    const validFactors = [1, 2, 4, 8];
    if (!validFactors.includes(factor)) {
      console.warn(`Invalid supersampling factor ${factor}, using 1`);
      factor = 1;
    }
    this.supersamplingFactor = factor;
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
    if (this.supersampledDepthTexture) {
      this.supersampledDepthTexture.destroy();
    }

    const supersampledWidth = width * this.supersamplingFactor;
    const supersampledHeight = height * this.supersamplingFactor;

    console.log(`Creating supersampled textures: ${supersampledWidth}x${supersampledHeight} (${this.supersamplingFactor}x)`);

    // Create color texture for supersampled rendering
    this.supersampledTexture = this.device.createTexture({
      size: { width: supersampledWidth, height: supersampledHeight },
      format: format,
      sampleCount: sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: `supersampled-color-${this.supersamplingFactor}x`
    });

    // Create depth texture for supersampled rendering
    this.supersampledDepthTexture = this.device.createTexture({
      size: { width: supersampledWidth, height: supersampledHeight },
      format: 'depth24plus',
      sampleCount: sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: `supersampled-depth-${this.supersamplingFactor}x`
    });

    // Create bind group for downsampling
    if (this.downsamplePipeline) {
      this.downsampleBindGroup = this.device.createBindGroup({
        layout: this.downsamplePipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: this.supersampledTexture.createView()
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
      depthTexture: this.supersampledDepthTexture
    };
  }

  getSupersampledDimensions(baseWidth: number, baseHeight: number) {
    return {
      width: baseWidth * this.supersamplingFactor,
      height: baseHeight * this.supersamplingFactor
    };
  }

  downsample(commandEncoder: GPUCommandEncoder, targetTexture: GPUTexture) {
    if (!this.downsamplePipeline || !this.downsampleBindGroup || !this.supersampledTexture) {
      console.warn('Downsample pipeline not ready');
      return;
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: targetTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.15, g: 0.15, b: 0.15, a: 1.0 }
      }]
    });

    renderPass.setPipeline(this.downsamplePipeline);
    renderPass.setBindGroup(0, this.downsampleBindGroup);
    renderPass.draw(6); // Full-screen quad

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
    if (this.supersampledDepthTexture) {
      this.supersampledDepthTexture.destroy();
      this.supersampledDepthTexture = null;
    }
  }
}
