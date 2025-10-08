export default class GPUCapabilities {
  private device: GPUDevice;
  private supportedSampleCounts: string[] = [];
  
  constructor(device: GPUDevice) {
    this.device = device;
  }
  
  async checkMSAASupport(format: GPUTextureFormat = 'bgra8unorm') {
    const testCounts = [1, 2, 4, 8, 16, 32];
    
    for (const sampleCount of testCounts) {
      // Push an error scope to catch validation errors
      this.device.pushErrorScope('validation');
      
      let testTexture: GPUTexture | null = null;
      let testPipeline: GPURenderPipeline | null = null;
      
      try {
        // Try to create a small test texture
        testTexture = this.device.createTexture({
          size: { width: 4, height: 4 },
          format: format,
          sampleCount: sampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          label: `msaa-test-${sampleCount}`
        });
        
        // Also test pipeline creation
        const testShader = this.device.createShaderModule({
          code: `
            @vertex
            fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
              return vec4<f32>(0.0, 0.0, 0.0, 1.0);
            }
            
            @fragment
            fn fs_main() -> @location(0) vec4<f32> {
              return vec4<f32>(1.0, 1.0, 1.0, 1.0);
            }
          `
        });
        
        testPipeline = this.device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: testShader,
            entryPoint: 'vs_main',
          },
          fragment: {
            module: testShader,
            entryPoint: 'fs_main',
            targets: [{
              format: format,
            }],
          },
          primitive: {
            topology: 'triangle-list',
          },
          multisample: {
            count: sampleCount,
          },
        });
        
        console.log(testPipeline);
        
        // Also try to create a depth texture with the same sample count
        const depthTexture = this.device.createTexture({
          size: { width: 4, height: 4 },
          format: 'depth24plus',
          sampleCount: sampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          label: `msaa-depth-test-${sampleCount}`
        });
        
        // Pop the error scope and check for errors
        const error = await this.device.popErrorScope();
        
        if (error) {
          // There was a validation error - this sample count is not supported
          console.log(`Sample count ${sampleCount} not supported: ${error.message}`);
          
          // Clean up any created resources
          testTexture?.destroy();
          depthTexture?.destroy();
        } else {
          // This sample count is supported.
          console.log(`Sample count ${sampleCount} is supported`);
          this.supportedSampleCounts.push(sampleCount.toString());
          
          // Clean up test resources
          testTexture?.destroy();
          depthTexture?.destroy();
        }
        
      } catch (e) {
        await this.device.popErrorScope();
        console.log(`Sample count ${sampleCount} threw error: ${e}`);
      }
    }
    
    // 1x should always be supported, right.... ._.
    if (!this.supportedSampleCounts.includes('1')) {
      console.warn('Even 1x MSAA not detected, adding it as fallback');
      this.supportedSampleCounts.unshift('1');
    }
    
    const numberArr = this.supportedSampleCounts.map((val) => parseInt(val));
    const maxSampleCount = numberArr.length > 0 ? Math.max(...numberArr) : 1;
    
    console.log(`📊 Supported MSAA sample counts: [${this.supportedSampleCounts.join(', ')}]`);
    console.log(`📊 Maximum supported: ${maxSampleCount}x`);
    
    return {
      maxSampleCount,
      supportedCounts: this.supportedSampleCounts,
      supports4x: this.supportedSampleCounts.includes('4'),
      supports8x: this.supportedSampleCounts.includes('8'),
      supports16x: this.supportedSampleCounts.includes('16')
    };
  }

  get sampleCountsSupported() {
    return this.supportedSampleCounts;
  }
}