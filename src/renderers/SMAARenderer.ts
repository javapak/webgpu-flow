export class SMAARenderer {
  private device: GPUDevice;
  private edgeDetectionPipeline!: GPURenderPipeline;
  private blendingWeightPipeline!: GPURenderPipeline;
  private neighborhoodBlendPipeline!: GPURenderPipeline;
  
  private edgesTexture!: GPUTexture;
  private blendTexture!: GPUTexture;
  
  private linearSampler!: GPUSampler;
  
  private edgeDetectionBindGroup!: GPUBindGroup;
  private blendingWeightBindGroup!: GPUBindGroup;
  private neighborhoodBlendBindGroup!: GPUBindGroup;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.createSamplers();
    this.createPipelines(format);
  }

  private createSamplers() {
    this.linearSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
  }

  private createPipelines(format: GPUTextureFormat) {
    const vertexShader = `
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
    `;

    // IMPROVED: Better edge detection with lower threshold
    const edgeDetectionShader = `
      ${vertexShader}

      @group(0) @binding(0) var inputTexture: texture_2d<f32>;
      @group(0) @binding(1) var inputSampler: sampler;

      const LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
      const EDGE_THRESHOLD = 0.15;  // Slightly higher to reduce noise

      fn rgb2luma(color: vec3<f32>) -> f32 {
        return dot(color, LUMA);
      }

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let textureDims = textureDimensions(inputTexture);
        let rcpFrame = vec2<f32>(1.0 / f32(textureDims.x), 1.0 / f32(textureDims.y));
        
        // Sample all neighbors first (uniform control flow)
        let colorM = textureSample(inputTexture, inputSampler, input.uv).rgb;
        let colorN = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(0.0, -1.0) * rcpFrame).rgb;
        let colorS = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(0.0, 1.0) * rcpFrame).rgb;
        let colorW = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(-1.0, 0.0) * rcpFrame).rgb;
        let colorE = textureSample(inputTexture, inputSampler, input.uv + vec2<f32>(1.0, 0.0) * rcpFrame).rgb;
        
        // Convert to luma
        let lumaM = rgb2luma(colorM);
        let lumaN = rgb2luma(colorN);
        let lumaS = rgb2luma(colorS);
        let lumaW = rgb2luma(colorW);
        let lumaE = rgb2luma(colorE);
        
        // Calculate deltas
        let deltaLeft = abs(lumaM - lumaW);
        let deltaRight = abs(lumaM - lumaE);
        let deltaTop = abs(lumaM - lumaN);
        let deltaBottom = abs(lumaM - lumaS);
        
        let maxDeltaHorz = max(deltaLeft, deltaRight);
        let maxDeltaVert = max(deltaTop, deltaBottom);
        
        // Store edge strength with smooth falloff
        var edges = vec2<f32>(0.0, 0.0);
        
        if (maxDeltaHorz >= EDGE_THRESHOLD) {
          // Smooth transition instead of hard cutoff
          edges.x = smoothstep(EDGE_THRESHOLD, EDGE_THRESHOLD * 2.0, maxDeltaHorz);
        }
        if (maxDeltaVert >= EDGE_THRESHOLD) {
          edges.y = smoothstep(EDGE_THRESHOLD, EDGE_THRESHOLD * 2.0, maxDeltaVert);
        }
        
        return vec4<f32>(edges, 0.0, 1.0);
      }
    `;

    // IMPROVED: Better weight calculation based on edge strength
    const blendingWeightShader = `
      ${vertexShader}

      @group(0) @binding(0) var edgesTexture: texture_2d<f32>;
      @group(0) @binding(1) var edgesSampler: sampler;

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let textureDims = textureDimensions(edgesTexture);
        let rcpFrame = vec2<f32>(1.0 / f32(textureDims.x), 1.0 / f32(textureDims.y));
        
        // Sample ALL textures first (uniform control flow)
        let edges = textureSample(edgesTexture, edgesSampler, input.uv).rg;
        let edgeN = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(0.0, -1.0) * rcpFrame).r;
        let edgeS = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(0.0, 1.0) * rcpFrame).r;
        let edgeW = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(-1.0, 0.0) * rcpFrame).g;
        let edgeE = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(1.0, 0.0) * rcpFrame).g;
        
        // Sample second-level neighbors for better pattern detection
        let edgeN2 = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(0.0, -2.0) * rcpFrame).r;
        let edgeS2 = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(0.0, 2.0) * rcpFrame).r;
        let edgeW2 = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(-2.0, 0.0) * rcpFrame).g;
        let edgeE2 = textureSample(edgesTexture, edgesSampler, input.uv + vec2<f32>(2.0, 0.0) * rcpFrame).g;
        
        var weights = vec4<f32>(0.0);
        
        // Horizontal edge - blend vertically with stronger weights
        if (edges.x > 0.05) {
          // Smooth edge continuation factor
          let continuesN = smoothstep(0.0, 0.3, edgeN) + smoothstep(0.0, 0.3, edgeN2) * 0.3;
          let continuesS = smoothstep(0.0, 0.3, edgeS) + smoothstep(0.0, 0.3, edgeS2) * 0.3;
          
          let blendStrength = edges.x * 0.25;
          
          weights.x = blendStrength * (0.5 + continuesN * 0.3);
          weights.y = blendStrength * (0.5 + continuesS * 0.3);
        }
        
        // Vertical edge
        if (edges.y > 0.05) {
          let continuesW = smoothstep(0.0, 0.3, edgeW) + smoothstep(0.0, 0.3, edgeW2) * 0.3;
          let continuesE = smoothstep(0.0, 0.3, edgeE) + smoothstep(0.0, 0.3, edgeE2) * 0.3;
          
          let blendStrength = edges.y * 0.25;
          
          weights.z = blendStrength * (0.5 + continuesW * 0.3);
          weights.w = blendStrength * (0.5 + continuesE * 0.3);
        }
        
        return weights;
      }
    `;

    const neighborhoodBlendShader = `
      ${vertexShader}

      @group(0) @binding(0) var colorTexture: texture_2d<f32>;
      @group(0) @binding(1) var colorSampler: sampler;
      @group(0) @binding(2) var blendTexture: texture_2d<f32>;
      @group(0) @binding(3) var blendSampler: sampler;

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let textureDims = textureDimensions(colorTexture);
        let rcpFrame = vec2<f32>(1.0 / f32(textureDims.x), 1.0 / f32(textureDims.y));
        
        // Sample ALL textures first (uniform control flow)
        let color = textureSample(colorTexture, colorSampler, input.uv);
        let weights = textureSample(blendTexture, blendSampler, input.uv);
        
        // Sample neighbors with slight sub-pixel offset for smoother blending
        let colorN = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(0.0, -1.0) * rcpFrame);
        let colorS = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(0.0, 1.0) * rcpFrame);
        let colorW = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(-1.0, 0.0) * rcpFrame);
        let colorE = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(1.0, 0.0) * rcpFrame);
        
        // Also sample diagonals for better smoothness
        let colorNW = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(-1.0, -1.0) * rcpFrame);
        let colorNE = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(1.0, -1.0) * rcpFrame);
        let colorSW = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(-1.0, 1.0) * rcpFrame);
        let colorSE = textureSample(colorTexture, colorSampler, input.uv + vec2<f32>(1.0, 1.0) * rcpFrame);
        
        // Calculate total weight
        let totalWeight = dot(weights, vec4<f32>(1.0));
        
        // Main directional blend
        var blendedColor = color * (1.0 - totalWeight);
        blendedColor += colorN * weights.x;
        blendedColor += colorS * weights.y;
        blendedColor += colorW * weights.z;
        blendedColor += colorE * weights.w;
        
        // Add subtle diagonal contribution for smoother transitions
        let diagonalWeight = totalWeight * 0.15;
        blendedColor += (colorNW + colorNE + colorSW + colorSE) * (diagonalWeight * 0.25);
        blendedColor *= (1.0 / (1.0 + diagonalWeight));
        
        return blendedColor;
      }
    `;

    // Create shader modules
    const edgeDetectionModule = this.device.createShaderModule({
      code: edgeDetectionShader,
      label: 'smaa-edge-detection-shader'
    });

    const blendingWeightModule = this.device.createShaderModule({
      code: blendingWeightShader,
      label: 'smaa-blending-weight-shader'
    });

    const neighborhoodBlendModule = this.device.createShaderModule({
      code: neighborhoodBlendShader,
      label: 'smaa-neighborhood-blend-shader'
    });

    // Create pipelines
    this.edgeDetectionPipeline = this.device.createRenderPipeline({
      label: 'smaa-edge-detection-pipeline',
      layout: 'auto',
      vertex: {
        module: edgeDetectionModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: edgeDetectionModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rg8unorm' }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.blendingWeightPipeline = this.device.createRenderPipeline({
      label: 'smaa-blending-weight-pipeline',
      layout: 'auto',
      vertex: {
        module: blendingWeightModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: blendingWeightModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.neighborhoodBlendPipeline = this.device.createRenderPipeline({
      label: 'smaa-neighborhood-blend-pipeline',
      layout: 'auto',
      vertex: {
        module: neighborhoodBlendModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: neighborhoodBlendModule,
        entryPoint: 'fs_main',
        targets: [{ format }]
      },
      primitive: { topology: 'triangle-list' }
    });
  }

  private createIntermediateTextures(width: number, height: number) {
    if (this.edgesTexture) {
      this.edgesTexture.destroy();
    }
    this.edgesTexture = this.device.createTexture({
      size: { width, height },
      format: 'rg8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'smaa-edges-texture'
    });

    if (this.blendTexture) {
      this.blendTexture.destroy();
    }
    this.blendTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'smaa-blend-texture'
    });
  }

  apply(
    commandEncoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    targetTexture: GPUTexture
  ) {
    const width = sourceTexture.width;
    const height = sourceTexture.height;

    if (!this.edgesTexture || 
        this.edgesTexture.width !== width || 
        this.edgesTexture.height !== height) {
      this.createIntermediateTextures(width, height);
    }

    // Pass 1: Edge Detection
    this.edgeDetectionBindGroup = this.device.createBindGroup({
      layout: this.edgeDetectionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.linearSampler }
      ]
    });

    const edgePass = commandEncoder.beginRenderPass({
      label: 'smaa-edge-detection-pass',
      colorAttachments: [{
        view: this.edgesTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });

    edgePass.setPipeline(this.edgeDetectionPipeline);
    edgePass.setBindGroup(0, this.edgeDetectionBindGroup);
    edgePass.draw(6);
    edgePass.end();

    // Pass 2: Blending Weight Calculation
    this.blendingWeightBindGroup = this.device.createBindGroup({
      layout: this.blendingWeightPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.edgesTexture.createView() },
        { binding: 1, resource: this.linearSampler }
      ]
    });

    const blendWeightPass = commandEncoder.beginRenderPass({
      label: 'smaa-blend-weight-pass',
      colorAttachments: [{
        view: this.blendTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });

    blendWeightPass.setPipeline(this.blendingWeightPipeline);
    blendWeightPass.setBindGroup(0, this.blendingWeightBindGroup);
    blendWeightPass.draw(6);
    blendWeightPass.end();

    // Pass 3: Neighborhood Blending
    this.neighborhoodBlendBindGroup = this.device.createBindGroup({
      layout: this.neighborhoodBlendPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: this.blendTexture.createView() },
        { binding: 3, resource: this.linearSampler }
      ]
    });

    const finalPass = commandEncoder.beginRenderPass({
      label: 'smaa-final-blend-pass',
      colorAttachments: [{
        view: targetTexture.createView(),
        loadOp: 'load',
        storeOp: 'store'
      }]
    });

    finalPass.setPipeline(this.neighborhoodBlendPipeline);
    finalPass.setBindGroup(0, this.neighborhoodBlendBindGroup);
    finalPass.draw(6);
    finalPass.end();
  }

  destroy() {
    this.edgesTexture?.destroy();
    this.blendTexture?.destroy();
  }
}