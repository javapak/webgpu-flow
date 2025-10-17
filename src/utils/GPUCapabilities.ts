export default class GPUCapabilities {
  private device: GPUDevice;
  private supportedSampleCounts: string[] = [];
  private maxTextureSize: number = 0;
  private supportedSupersamplingFactors: number[] = [];
  
  constructor(device: GPUDevice) {
    this.device = device;
  }
  
  async checkMSAASupport(format: GPUTextureFormat = 'bgra8unorm') {
    const testCounts = [1, 2, 4, 8, 16, 32];
    
    for (const sampleCount of testCounts) {
      this.device.pushErrorScope('validation');
      this.device.pushErrorScope('out-of-memory');
      
      let testTexture: GPUTexture | null = null;
      let testPipeline: GPURenderPipeline | null = null;
      let depthTexture: GPUTexture | null = null;
      
      try {
        testTexture = this.device.createTexture({
          size: { width: 10, height: 10 },
          format: format,
          sampleCount: sampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          label: `msaa-test-${sampleCount}`
        });
        
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
        
        depthTexture = this.device.createTexture({
          size: { width: 10, height: 10 },
          format: 'depth24plus',
          sampleCount: sampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          label: `msaa-depth-test-${sampleCount}`
        });
        
        // Check both error scopes
        const memoryError = await this.device.popErrorScope();
        const validationError = await this.device.popErrorScope();
        console.log(testPipeline);
        
        if (memoryError || validationError) {
          const error = memoryError || validationError;
          console.warn(`Sample count ${sampleCount} not supported: ${error?.message}`);
        } else {
          console.log(`Sample count ${sampleCount} is supported`);
          this.supportedSampleCounts.push(sampleCount.toString());
        }
        
      } catch (e) {
        console.error(`Sample count ${sampleCount} threw exception: ${e}`);
        // Still need to pop error scopes even on exception
        await this.device.popErrorScope().catch(() => {});
        await this.device.popErrorScope().catch(() => {});
      } finally {
        // Clean up test resources
        testTexture?.destroy();
        depthTexture?.destroy();
      }
    }
    
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

  /**
   * Check what supersampling factors are supported based on GPU texture size limits
   */
  async checkSupersamplingSupport(
    baseWidth: number, 
    baseHeight: number,
    sampleCount: number = 1,
    format: GPUTextureFormat = 'bgra8unorm'
  ): Promise<{
    maxFactor: number;
    supportedFactors: number[];
    maxTextureSize: number;
    recommendations: string[];
    warnings: string[];
  }> {
    console.log('🔍 Checking supersampling support...');
    
    // Get adapter to check limits
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('Could not get GPU adapter');
      return {
        maxFactor: 1,
        supportedFactors: [1],
        maxTextureSize: 0,
        recommendations: ['Supersampling not supported'],
        warnings: ['Could not access GPU adapter']
      };
    }

    // Get maximum texture dimension from limits
    this.maxTextureSize = adapter.limits.maxTextureDimension2D;
    console.log(`Max texture size: ${this.maxTextureSize}x${this.maxTextureSize}`);
    console.log(`Base canvas size: ${baseWidth}x${baseHeight}`);
    console.log(`Sample count: ${sampleCount}x`);

    const testFactors = [1, 2, 4, 8];
    const supportedFactors: number[] = [];
    const recommendations: string[] = [];
    const warnings: string[] = [];

    for (const factor of testFactors) {
      const supersampledWidth = baseWidth * factor;
      const supersampledHeight = baseHeight * factor;

      // Check if dimensions exceed GPU limits
      if (supersampledWidth > this.maxTextureSize || supersampledHeight > this.maxTextureSize) {
        console.log(`${factor}x supersampling: ${supersampledWidth}x${supersampledHeight} exceeds max texture size (${this.maxTextureSize})`);
        warnings.push(`${factor}x exceeds GPU texture size limit`);
        break;
      }

      // Push error scopes BEFORE creating resources
      this.device.pushErrorScope('validation');
      this.device.pushErrorScope('out-of-memory');
      
      let testColorTexture: GPUTexture | null = null;
      let testDepthTexture: GPUTexture | null = null;
      let testMSAATexture: GPUTexture | null = null;
      
      try {
        // Test creating all required textures for this supersampling factor
        
        // 1. Color texture (resolve target if using MSAA)
        testColorTexture = this.device.createTexture({
          size: { width: supersampledWidth, height: supersampledHeight },
          format: format,
          sampleCount: 1, // Resolve target is always 1x
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
          label: `supersampling-color-test-${factor}x`
        });

        // 2. MSAA texture if needed
        if (sampleCount > 1) {
          testMSAATexture = this.device.createTexture({
            size: { width: supersampledWidth, height: supersampledHeight },
            format: format,
            sampleCount: sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: `supersampling-msaa-test-${factor}x-${sampleCount}x`
          });
        }

        // 3. Depth texture
        testDepthTexture = this.device.createTexture({
          size: { width: supersampledWidth, height: supersampledHeight },
          format: 'depth24plus',
          sampleCount: sampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          label: `supersampling-depth-test-${factor}x`
        });

        // Pop error scopes and check for errors
        const memoryError = await this.device.popErrorScope();
        const validationError = await this.device.popErrorScope();
        
        if (memoryError) {
          console.log(`❌ ${factor}x supersampling: Out of memory`);
          warnings.push(`${factor}x: Insufficient GPU memory`);
          break; // Stop testing higher factors
        }
        
        if (validationError) {
          console.log(`❌ ${factor}x supersampling: Validation error - ${validationError.message}`);
          warnings.push(`${factor}x: ${validationError.message}`);
          break;
        }
        
        // Success!
        console.log(`${factor}x supersampling: ${supersampledWidth}x${supersampledHeight} is supported`);
        supportedFactors.push(factor);

        // Add recommendations based on performance
        const totalPixels = supersampledWidth * supersampledHeight;
        const memoryEstimateMB = (totalPixels * 4 * (sampleCount > 1 ? 3 : 2)) / (1024 * 1024);
        
        if (factor === 1) {
          recommendations.push('1x: No supersampling (standard quality)');
        } else if (factor === 2) {
          recommendations.push(`2x: Good balance (4x pixels, ~${memoryEstimateMB.toFixed(0)}MB) - Recommended`);
        } else if (factor === 4) {
          if (totalPixels > 16777216) { // 4096x4096
            recommendations.push(`4x: High quality but demanding (16x pixels, ~${memoryEstimateMB.toFixed(0)}MB)`);
            warnings.push(`4x: Very high resolution (${supersampledWidth}x${supersampledHeight})`);
          } else {
            recommendations.push(`4x: Excellent quality (16x pixels, ~${memoryEstimateMB.toFixed(0)}MB)`);
          }
        } else if (factor === 8) {
          recommendations.push(`8x: Maximum quality (64x pixels, ~${memoryEstimateMB.toFixed(0)}MB)`);
          warnings.push(`8x: Extreme performance cost - not recommended for real-time`);
        }
        
      } catch (e) {
        console.error(`❌ ${factor}x supersampling threw exception (current pixel multiplier:): ${e}`);
        warnings.push(`${factor}x: Failed with error - ${e}`);
  
        
        // Still need to pop error scopes even on exception
        try {
          await this.device.popErrorScope();
          await this.device.popErrorScope();
        } catch (popError) {
          console.error('Error popping error scopes:', popError);
        }
        
        break; // Stop testing higher factors
        
      } finally {
        // Always clean up test resources
        testColorTexture?.destroy();
        testMSAATexture?.destroy();
        testDepthTexture?.destroy();
      }
    }

    const maxFactor = supportedFactors.length > 0 ? Math.max(...supportedFactors) : 1;

    console.log(`📊 Supersampling support summary:`);
    console.log(`   Supported factors: [${supportedFactors.join(', ')}]`);
    console.log(`   Maximum factor: ${maxFactor}x`);
    if (warnings.length > 0) {
      console.log(`   Warnings: ${warnings.length}`);
    }

    this.supportedSupersamplingFactors = supportedFactors;

    return {
      maxFactor,
      supportedFactors,
      maxTextureSize: this.maxTextureSize,
      recommendations,
      warnings
    };
  }

  /**
   * Get recommended supersampling factor based on canvas size and GPU capabilities
   */
  getRecommendedSupersamplingFactor(width: number, height: number): number {
    const totalPixels = width * height;
    
    // For very high resolution displays, don't recommend supersampling
    if (totalPixels > 8294400) { // 3840x2160 (4K)
      return 1;
    }
    
    // For high resolution displays, only recommend 2x
    if (totalPixels > 2073600) { // 1920x1080 (Full HD)
      return this.supportedSupersamplingFactors.includes(2) ? 2 : 1;
    }
    
    // For standard resolution, recommend 4x if supported, otherwise 2x
    if (this.supportedSupersamplingFactors.includes(4)) {
      return 4;
    }
    
    if (this.supportedSupersamplingFactors.includes(2)) {
      return 2;
    }
    
    return 1;
  }

  get sampleCountsSupported() {
    return this.supportedSampleCounts;
  }

  get supersamplingFactorsSupported() {
    return this.supportedSupersamplingFactors;
  }
}