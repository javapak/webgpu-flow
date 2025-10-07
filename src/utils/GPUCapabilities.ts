
export default class GPUCapabilities {
  private device: GPUDevice;
  private supportedSampleCounts: string[] = ['1']; // ✅ Initialize with '1' which is always supported
  
  constructor(device: GPUDevice) {
    this.device = device;
  }
  
  async checkMSAASupport(format: GPUTextureFormat = 'bgra8unorm') {
    // Reset to just '1' before checking
    this.supportedSampleCounts = ['1'];
    
    const testCounts = [4, 8, 16]; // Test 4x, 8x, 16x (skip 2x - rarely supported)
    
    for (const sampleCount of testCounts) {
      try {
        // Try to create a minimal test texture
        const testTexture = this.device.createTexture({
          size: { width: 1, height: 1 },
          format: format,
          sampleCount: sampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          label: `msaa-test-${sampleCount}`
        });
        
        // If we got here without throwing, it's supported
        this.supportedSampleCounts.push(sampleCount.toString());
        console.log(`✅ Sample count ${sampleCount}x is SUPPORTED`);
        
        // Clean up immediately
        testTexture.destroy();
        
      } catch (e) {
        // This sample count is NOT supported
        console.error(`❌ Sample count ${sampleCount}x is NOT supported`);
        // Continue checking other counts
      }
    }

    const numberArr = this.supportedSampleCounts.map((val) => parseInt(val));
    const maxSampleCount = Math.max(...numberArr);
    
    console.log('✅ All supported MSAA sample counts:', this.supportedSampleCounts);
    
    return {
      maxSampleCount,
      supportedCounts: this.supportedSampleCounts,
      supports4x: this.supportedSampleCounts.includes('4'),
      supports8x: this.supportedSampleCounts.includes('8'),
      supports16x: this.supportedSampleCounts.includes('16')
    };
  }

  get sampleCountsSupported(): string[] {
    // Always return at least ['1'] even before checkMSAASupport is called
    return this.supportedSampleCounts.length > 0 ? this.supportedSampleCounts : ['1'];
  }
}