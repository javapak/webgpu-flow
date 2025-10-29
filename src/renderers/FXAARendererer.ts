export class FXAARenderer {
  private device: GPUDevice;
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private bindGroupLayout!: GPUBindGroupLayout;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.createPipeline(format);
  }

  private createPipeline(format: GPUTextureFormat) {
  const shaderCode = `
    @group(0) @binding(0) var inputTexture: texture_2d<f32>;
    @group(0) @binding(1) var inputSampler: sampler;
    
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
      let textureDims = textureDimensions(inputTexture);
      let rcpFrame = vec2<f32>(1.0 / f32(textureDims.x), 1.0 / f32(textureDims.y));
      
      // Sample ALL neighbors unconditionally (uniform control flow)
      let rgbM = textureSample(inputTexture, inputSampler, input.uv).rgb;
      let rgbN = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(0.0, -1.0) * rcpFrame).rgb;
      let rgbS = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(0.0, 1.0) * rcpFrame).rgb;
      let rgbW = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(-1.0, 0.0) * rcpFrame).rgb;
      let rgbE = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(1.0, 0.0) * rcpFrame).rgb;
      let rgbNW = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(-1.0, -1.0) * rcpFrame).rgb;
      let rgbNE = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(1.0, -1.0) * rcpFrame).rgb;
      let rgbSW = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(-1.0, 1.0) * rcpFrame).rgb;
      let rgbSE = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(1.0, 1.0) * rcpFrame).rgb;
      
      // Luma conversion
      let luma = vec3<f32>(0.299, 0.587, 0.114);
      let lumaM = dot(rgbM, luma);
      let lumaN = dot(rgbN, luma);
      let lumaS = dot(rgbS, luma);
      let lumaW = dot(rgbW, luma);
      let lumaE = dot(rgbE, luma);
      let lumaNW = dot(rgbNW, luma);
      let lumaNE = dot(rgbNE, luma);
      let lumaSW = dot(rgbSW, luma);
      let lumaSE = dot(rgbSE, luma);
      
      // Find min/max luma
      let lumaMin = min(lumaM, min(min(min(lumaN, lumaS), min(lumaW, lumaE)), 
                                    min(min(lumaNW, lumaNE), min(lumaSW, lumaSE))));
      let lumaMax = max(lumaM, max(max(max(lumaN, lumaS), max(lumaW, lumaE)), 
                                    max(max(lumaNW, lumaNE), max(lumaSW, lumaSE))));
      let lumaRange = lumaMax - lumaMin;
      
      // Compute edge threshold
      let edgeThreshold = max(0.0312, lumaMax * 0.87); 
      // Determine if we should apply FXAA (but don't use textureSample in branches)
      let shouldApplyFXAA = f32(lumaRange >= edgeThreshold);
      
      // Edge direction
      let edgeVert = abs((lumaN + lumaS) - 2.0 * lumaM);
      let edgeHorz = abs((lumaW + lumaE) - 2.0 * lumaM);
      let isHorizontal = edgeHorz >= edgeVert;
      
      // Select edge samples
      let luma1 = select(lumaW, lumaN, isHorizontal);
      let luma2 = select(lumaE, lumaS, isHorizontal);
      let gradient1 = abs(luma1 - lumaM);
      let gradient2 = abs(luma2 - lumaM);
      
      // Determine offset direction
      let stepLength = select(rcpFrame.x, rcpFrame.y, isHorizontal);
      let lumaLocalAverage = (luma1 + luma2) * 0.05;
      let gradientScaled = max(gradient1, gradient2) * 0.125;
      
      // Calculate offset (always calculate, but conditionally apply later)
      let offsetDir = select(-stepLength, stepLength, luma1 < luma2);
      let shouldOffset = f32(abs(lumaM - lumaLocalAverage) >= gradientScaled);
      let offset = offsetDir * shouldOffset;
      
      // Calculate UV offset
      let uvOffset = select(
        vec2<f32>(input.uv.x + offset, input.uv.y),
        vec2<f32>(input.uv.x, input.uv.y + offset),
        isHorizontal
      );
      
      // Sample with offset (always sample, no branching)
      let rgbF = textureSample(inputTexture, inputSampler, uvOffset).rgb;
      
      // Blend between original and filtered based on whether FXAA should apply
      let finalRgb = mix(rgbM, rgbF, shouldApplyFXAA);

      const FXAA_SUBPIX = 0.25;  // 0.0 = off, 1.0 = max blur
      let lumaAvg = (lumaN + lumaS + lumaE + lumaW) * 0.25;
      let subpixelOffset = abs(lumaM - lumaAvg) / lumaRange;
      let subpixelBlend = smoothstep(0.0, 1.0, subpixelOffset);
      let subpixelFactor = subpixelBlend * subpixelBlend * FXAA_SUBPIX;
        
      let rgbSubpix = (rgbN + rgbS + rgbE + rgbW) * 0.25;
      let finalRgbWithSubpix = mix(finalRgb, rgbSubpix, subpixelFactor);
      return vec4<f32>(finalRgbWithSubpix, 1.0);
      

    }
    `;

    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
      label: 'fxaa-shader'
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' }
        }
      ]
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
  }

  apply(
    commandEncoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    targetTexture: GPUTexture
  ) {
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.sampler }
      ]
    });

    const renderPass = commandEncoder.beginRenderPass({
      label: 'fxaa-pass',
      colorAttachments: [{
        view: targetTexture.createView(),
        loadOp: 'load',
        storeOp: 'store'
      }]
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(6);
    renderPass.end();
  }

  destroy() {
    // Nothing to destroy - pipeline and sampler are owned by device
  }
}