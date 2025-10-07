 export interface TextureAtlasEntry {
  texture: GPUTexture;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class TextureAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: GPUTexture | null = null;
  private device: GPUDevice;
  private entries: Map<string, TextureAtlasEntry> = new Map();
  
  // Atlas configuration
  private readonly ATLAS_SIZE = 4096; 
  private currentX = 0;
  private currentY = 0;
  private currentRowHeight = 0;
  private needsUpdate = false;

  constructor(device: GPUDevice) {
    this.device = device;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.ATLAS_SIZE;
    this.canvas.height = this.ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.textRendering = 'optimizeLegibility';

    this.ctx.clearRect(0, 0, this.ATLAS_SIZE, this.ATLAS_SIZE);
    this.createGPUTexture();
  }

  private createGPUTexture() {
    if (this.texture) {
      this.texture.destroy();
    }

    this.texture = this.device.createTexture({
      size: [this.ATLAS_SIZE, this.ATLAS_SIZE],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: 1
    });
  }

  addText(text: string, fontSize: number = 50, color: string = '#ffffff'): TextureAtlasEntry | null {
    const cacheKey = `${text}-${fontSize}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    // Measure text
    this.ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    const metrics = this.ctx.measureText(text);
    const textWidth = Math.ceil(metrics.width + 8); // Add padding
    const textHeight = Math.ceil(fontSize * 1.5); // Add vertical padding

    // Check if we need to move to next row
    if (this.currentX + textWidth > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + 2; // 2px row spacing
      this.currentRowHeight = 0;
    }

    if (this.currentY + textHeight > this.ATLAS_SIZE) {
      console.warn('Text atlas is full! Consider increasing atlas size or implementing atlas paging.');
      return null;
    }

    this.ctx.clearRect(this.currentX, this.currentY, textWidth, textHeight);

    // Render text to atlas
    this.ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = 10;
    this.ctx.fillText(text, this.currentX + 4, this.currentY + 4);
    // Reset shadow
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;

    // Create entry
    const entry: TextureAtlasEntry = {
      texture: this.texture!,
      x: this.currentX,
      y: this.currentY,
      width: textWidth,
      height: textHeight
    };

    this.entries.set(cacheKey, entry);
    
    // Update position tracking
    this.currentX += textWidth + 2; // 2px horizontal spacing
    this.currentRowHeight = Math.max(this.currentRowHeight, textHeight);
    this.needsUpdate = true;

    return entry;
  }

  updateGPUTexture() {
    if (!this.needsUpdate || !this.texture) return;

    // Copy canvas data to GPU texture
    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas },
      { texture: this.texture },
      { width: this.ATLAS_SIZE, height: this.ATLAS_SIZE }
    );

    this.needsUpdate = false;
  }

  getTexture(): GPUTexture | null {
    return this.texture;
  }

  getAtlasSize(): number {
    return this.ATLAS_SIZE;
  }

  clear() {
    this.entries.clear();
    this.currentX = 0;
    this.currentY = 0;
    this.currentRowHeight = 0;
    this.ctx.clearRect(0, 0, this.ATLAS_SIZE, this.ATLAS_SIZE);
    this.needsUpdate = true;
  }

  destroy() {
    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }
    this.entries.clear();
  }

  // Debug method to see the atlas
  getDebugCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // Get usage statistics
  getStats() {
    return {
      totalEntries: this.entries.size,
      currentX: this.currentX,
      currentY: this.currentY,
      currentRowHeight: this.currentRowHeight,
      atlasSize: this.ATLAS_SIZE,
      usagePercentage: ((this.currentY + this.currentRowHeight) / this.ATLAS_SIZE) * 100
    };
  }
}
