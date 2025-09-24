// VisualContentAtlas.ts - Dedicated atlas for images and SVGs

export interface VisualAtlasEntry {
  texture: GPUTexture;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;  // Keep track of original dimensions
  originalHeight: number;
  type: 'image' | 'svg';
}

export class VisualContentAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: GPUTexture | null = null;
  private device: GPUDevice;
  private entries: Map<string, VisualAtlasEntry> = new Map();
  
  // Atlas configuration - larger for visual content
  private readonly ATLAS_SIZE = 2048; // 2K atlas for images/SVGs
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
    
    // High-quality rendering for images
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    
    // Clear with transparent background
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
    });
  }

  // Add image from URL
  addImage(url: string, maxSize: {width: number, height: number} = {width: 128, height: 128}): VisualAtlasEntry | null {
    const cacheKey = `img-${url}-${maxSize}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    try {
      const img = this.loadImage(url);
      return this.addImageElement(img, cacheKey, maxSize);
    } catch (error) {
      console.error('Failed to load image:', url, error);
      return null;
    }
  }

  // Add image from HTMLImageElement or ImageBitmap
  addImageElement(
    img: HTMLImageElement | ImageBitmap, 
    cacheKey: string, 
    maxSize: {width: number, height: number} = {width: 128, height: 128}
  ): VisualAtlasEntry | null {
    const originalWidth = img.width;
    const originalHeight = img.height;
    
    // Calculate scaled dimensions while preserving aspect ratio
    const scale = Math.min(maxSize.width / originalWidth, maxSize.height / originalHeight, 1);
    const scaledWidth = Math.ceil(originalWidth * scale);
    const scaledHeight = Math.ceil(originalHeight * scale);

    if (!this.canFit(scaledWidth, scaledHeight)) {
      console.warn('Image too large for visual atlas:', cacheKey);
      return null;
    }

    const entry = this.allocateSpace(scaledWidth, scaledHeight, originalWidth, originalHeight, 'image');
    
    // Draw image flipped for WebGPU coordinate system
    this.ctx.save();
    this.ctx.translate(entry.x + scaledWidth/2, entry.y + scaledHeight/2);
    this.ctx.scale(1, -1); // Flip Y for WebGPU
    this.ctx.translate(-scaledWidth/2, -scaledHeight/2);
    
    this.ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
    
    this.ctx.restore();
    
    this.entries.set(cacheKey, entry);
    this.needsUpdate = true;
    console.log(`Added image to visual atlas: ${scaledWidth}x${scaledHeight}`);
    return entry;
  }

  // Add SVG from string
  addSVG(svgString: string, width: number = 64, height: number = 64): VisualAtlasEntry | null {
    const cacheKey = `svg-${this.hashString(svgString)}-${width}x${height}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    if (!this.canFit(width, height)) {
      console.warn('SVG too large for visual atlas');
      return null;
    }

    try {
      const img = this.svgToImage(svgString, width, height);
      return this.addImageElement(img, cacheKey, {width, height});
    } catch (error) {
      console.error('Failed to render SVG:', error);
      return null;
    }
  }

  // Add emoji or unicode symbol (renders as image)
  addEmoji(emoji: string, size: {width: number, height: number} = {width: 64, height: 64}, color: string = '#000000'): VisualAtlasEntry | null {
    const cacheKey = `emoji-${emoji}-${size}-${color}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    if (!this.canFit(size.width, size.height)) {
      console.warn('Emoji too large for visual atlas');
      return null;
    }

    const entry = this.allocateSpace(size.width, size.height, size.width, size.height, 'image');
    
    // Draw emoji flipped for WebGPU
    this.ctx.save();
    this.ctx.translate(entry.x + size.width/2, entry.y + size.height/2);
    this.ctx.scale(1, -1);
    this.ctx.translate(-size/2, -size/2);
    
    // Clear background
    this.ctx.clearRect(0, 0, size.width, size.height);
    
    // Draw emoji
    this.ctx.font = `${size.width * 0.8}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(emoji, size.width/2, size.height/2);
    
    this.ctx.restore();
    
    this.entries.set(cacheKey, entry);
    this.needsUpdate = true;
    console.log(`Added emoji to visual atlas: ${emoji}`);
    return entry;
  }

  // Helper methods
  private canFit(width: number, height: number): boolean {
    // Check if we can fit in current row
    if (this.currentX + width <= this.ATLAS_SIZE && this.currentY + height <= this.ATLAS_SIZE) {
      return true;
    }
    
    // Check if we can fit in next row
    const nextRowY = this.currentY + this.currentRowHeight + 4; // 4px row spacing
    return nextRowY + height <= this.ATLAS_SIZE && width <= this.ATLAS_SIZE;
  }

  private allocateSpace(
    width: number, 
    height: number, 
    originalWidth: number,
    originalHeight: number,
    type: 'image' | 'svg'
  ): VisualAtlasEntry {
    // Move to next row if needed
    if (this.currentX + width > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + 4; // 4px row spacing for images
      this.currentRowHeight = 0;
    }

    const entry: VisualAtlasEntry = {
      texture: this.texture!,
      x: this.currentX,
      y: this.currentY,
      width,
      height,
      originalWidth,
      originalHeight,
      type
    };

    // Update position tracking
    this.currentX += width + 4; // 4px spacing between images
    this.currentRowHeight = Math.max(this.currentRowHeight, height);

    return entry;
  }

  private loadImage(url: string): HTMLImageElement {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      return img;
  }

  private svgToImage(svgString: string, width: number, height: number): HTMLImageElement {

      // Ensure SVG has proper dimensions
      let svg = svgString;
      if (!svg.includes('width=') && !svg.includes('viewBox=')) {
        svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${svgString}</svg>`;
      } else if (!svg.startsWith('<svg')) {
        svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgString}</svg>`;
      }
      
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      
      const img = new Image();
     
      img.src = url;
      return img;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  updateGPUTexture() {
    if (!this.needsUpdate || !this.texture) return;

    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas },
      { texture: this.texture },
      { width: this.ATLAS_SIZE, height: this.ATLAS_SIZE }
    );

    this.needsUpdate = false;
    console.log('Updated visual content atlas GPU texture');
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

  getStats() {
    const entries = Array.from(this.entries.values());
    return {
      totalEntries: entries.length,
      imageEntries: entries.filter(e => e.type === 'image').length,
      svgEntries: entries.filter(e => e.type === 'svg').length,
      currentX: this.currentX,
      currentY: this.currentY,
      currentRowHeight: this.currentRowHeight,
      atlasSize: this.ATLAS_SIZE,
      usagePercentage: ((this.currentY + this.currentRowHeight) / this.ATLAS_SIZE) * 100
    };
  }

  getDebugCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // Get all entries for debugging
  getEntries(): Map<string, VisualAtlasEntry> {
    return new Map(this.entries);
  }

  destroy() {
    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }
    this.entries.clear();
  }
}

