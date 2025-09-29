export default class GPUCapabilities {
  private device: GPUDevice;
  private supportedSampleCounts: string[] = [];
  constructor(device: GPUDevice) {
    this.device = device;
  }
  async checkMSAASupport(format: GPUTextureFormat = 'bgra8unorm') {
    for (const sampleCount of [1, 2, 4, 8, 16]) {
        try {
        // Try to create a texture with this sample count
        const testTexture = this.device.createTexture({
            size: { width: 1, height: 1 },
            format: format,
            sampleCount: sampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        
        this.supportedSampleCounts.push(sampleCount.toString());
        testTexture.destroy();
        } catch (e) {
        // This sample count is not supported
        break; // Higher counts won't be supported either
        }
    }

    let numberArr = this.supportedSampleCounts.map((val) => parseInt(val));
    
    const maxSampleCount = Math.max(...numberArr);
    
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