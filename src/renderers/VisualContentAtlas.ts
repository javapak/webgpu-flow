import type { DiagramNode } from "../types";

export interface VisualAtlasEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  colorizable: boolean; // Track if this entry supports color tinting
}

export class VisualContentAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: GPUTexture | null = null;
  private device: GPUDevice;
  private entries: Map<string, VisualAtlasEntry> = new Map();
  private sampleCount: string;
  
  // Cache for loaded images
  private imageCache: Map<string, HTMLImageElement> = new Map();
  
  // Atlas configuration
  private readonly ATLAS_SIZE = 2048; 
  private currentX = 0;
  private currentY = 0;
  private currentRowHeight = 0;
  private needsUpdate = false;

  constructor(device: GPUDevice, sampleCount = '1') {
    this.sampleCount = sampleCount;
    this.device = device;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.ATLAS_SIZE;
    this.canvas.height = this.ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    
    // High quality rendering
    this.ctx.textRendering = 'optimizeLegibility';
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    
    // Clear to transparent
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

  /**
   * Hash content WITHOUT color for reusability
   */
  private hashContent(content: string, size: number): string {
    let hash = 5381;
    const fullString = `${content}-${size}`;
    for (let i = 0; i < fullString.length; i++) {
      hash = ((hash << 5) + hash + fullString.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  /**
   * Rewrite SVG to use a single replaceable color
   * Converts fills and strokes to use a template color that can be tinted
   */
  private prepareSVGForColorTinting(svgString: string): string {
    let processedSvg = svgString.trim();
    
    // Strategy: Replace all fill and stroke colors with white
    // Then we'll multiply by the desired color in the shader
    
    // Replace fill attributes with white
    processedSvg = processedSvg.replace(/fill="[^"]*"/g, 'fill="white"');
    processedSvg = processedSvg.replace(/fill:[^;"]*/g, 'fill:white');
    processedSvg = processedSvg.replace(/stop-color:[^;"]*/g, 'stop-color:white');
    processedSvg = processedSvg.replace(/stop-color="[^"]*"/g, 'stop-color="white"');
    
    return processedSvg;
  }

  /**
   * Convert SVG string to Image for rendering
   */
  private async svgToImage(svgString: string, width: number, height: number, colorizable: boolean = false): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      let processedSvg = svgString.trim();
      
      // If colorizable, prepare SVG for tinting
      if (colorizable) {
        processedSvg = this.prepareSVGForColorTinting(processedSvg);
      }
      
      // Add viewBox if not present
      if (!processedSvg.includes('viewBox')) {
        processedSvg = processedSvg.replace(
          /<svg/,
          `<svg viewBox="0 0 ${width} ${height}"`
        );
      }
      
      // Add width and height if not present
      if (!processedSvg.includes('width=')) {
        processedSvg = processedSvg.replace(
          /<svg/,
          `<svg width="${width}" height="${height}"`
        );
      }
      
      // Ensure xmlns is present
      if (!processedSvg.includes('xmlns')) {
        processedSvg = processedSvg.replace(
          /<svg/,
          '<svg xmlns="http://www.w3.org/2000/svg"'
        );
      }

      const blob = new Blob([processedSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      
      const img = new Image();
      img.width = width;
      img.height = height;
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        console.error('Failed to load SVG:', e);
        reject(new Error('Failed to load SVG'));
      };
      
      img.src = url;
    });
  }

  /**
   * Add SVG content to the atlas
   * @param colorizable - If true, SVG will be prepared for GPU color tinting
   */
  async addSVG(
    svgString: string, 
    size: number = 64, 
    node: DiagramNode,
    colorizable: boolean = false
  ): Promise<VisualAtlasEntry | null> {
    // Cache key doesn't include color if colorizable
    const cacheKey = `svg:${this.hashContent(svgString, size)}${colorizable ? '-colorizable' : ''}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    node.visual!.cacheKey = cacheKey;

    const padding = 4;
    const totalSize = size + padding * 2;

    if (this.currentX + totalSize > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + padding;
      this.currentRowHeight = 0;
    }

    if (this.currentY + totalSize > this.ATLAS_SIZE) {
      console.warn('Visual atlas is full!');
      return null;
    }

    try {
      const img = await this.svgToImage(svgString, size, size, colorizable);
      
      this.ctx.clearRect(this.currentX, this.currentY, totalSize, totalSize);

      this.ctx.drawImage(
        img,
        this.currentX + padding,
        this.currentY + padding,
        size,
        size
      );

      const entry: VisualAtlasEntry = {
        x: this.currentX,
        y: this.currentY,
        width: totalSize,
        height: totalSize,
        colorizable: colorizable
      };

      this.entries.set(cacheKey, entry);
      
      this.currentX += totalSize + padding;
      this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
      this.needsUpdate = true;

      console.log(`Added ${colorizable ? 'colorizable ' : ''}SVG to atlas at (${entry.x}, ${entry.y})`);
      return entry;
    } catch (error) {
      console.error('Failed to add SVG to atlas:', error);
      return null;
    }
  }

  /**
   * Add emoji to atlas 
   */
  addEmoji(emoji: string, size: number = 64, node: DiagramNode): VisualAtlasEntry | null {
    const cacheKey = `emoji:${emoji}-${size}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    node.visual!.cacheKey = cacheKey;

    const padding = 4;
    const totalSize = size + padding * 2;

    if (this.currentX + totalSize > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + padding;
      this.currentRowHeight = 0;
    }

    if (this.currentY + totalSize > this.ATLAS_SIZE) {
      console.warn('Visual atlas is full!');
      return null;
    }

    this.ctx.clearRect(this.currentX, this.currentY, totalSize, totalSize);

    this.ctx.font = `${size}px system-ui, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    const centerX = this.currentX + totalSize / 2;
    const centerY = this.currentY + totalSize / 2;
    
    this.ctx.fillText(emoji, centerX, centerY);

    const entry: VisualAtlasEntry = {
      x: this.currentX,
      y: this.currentY,
      width: totalSize,
      height: totalSize,
      colorizable: false
    };

    this.entries.set(cacheKey, entry);
    
    this.currentX += totalSize + padding;
    this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
    this.needsUpdate = true;

    return entry;
  }

  /**
   * Add external image URL to atlas
   */
  async addImageURL(imageUrl: string, size: number = 64, node: DiagramNode): Promise<VisualAtlasEntry | null> {
    const cacheKey = `image:${this.hashContent(imageUrl, size)}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    node.visual!.cacheKey = cacheKey;

    const padding = 4;
    const totalSize = size + padding * 2;

    if (this.currentX + totalSize > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + padding;
      this.currentRowHeight = 0;
    }

    if (this.currentY + totalSize > this.ATLAS_SIZE) {
      console.warn('Visual atlas is full!');
      return null;
    }

    try {
      let img = this.imageCache.get(imageUrl);
      
      if (!img) {
        img = await this.loadImage(imageUrl);
        this.imageCache.set(imageUrl, img);
      }

      this.ctx.clearRect(this.currentX, this.currentY, totalSize, totalSize);

      this.ctx.drawImage(
        img,
        this.currentX + padding,
        this.currentY + padding,
        size,
        size
      );

      const entry: VisualAtlasEntry = {
        x: this.currentX,
        y: this.currentY,
        width: totalSize,
        height: totalSize,
        colorizable: false
      };

      this.entries.set(cacheKey, entry);
      
      this.currentX += totalSize + padding;
      this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
      this.needsUpdate = true;

      console.log(`Added image to atlas at (${entry.x}, ${entry.y})`);
      return entry;
    } catch (error) {
      console.error('Failed to add image to atlas:', error);
      return null;
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      
      img.src = url;
    });
  }

  addColoredShape(shape: string, color: string, size: number = 64, node: DiagramNode): VisualAtlasEntry | null {
    const cacheKey = `shape:${shape}-${color}-${size}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    node.visual!.cacheKey = cacheKey;

    const padding = 4;
    const totalSize = size + padding * 2;

    if (this.currentX + totalSize > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + padding;
      this.currentRowHeight = 0;
    }

    if (this.currentY + totalSize > this.ATLAS_SIZE) {
      console.warn('Visual atlas is full!');
      return null;
    }

    this.ctx.clearRect(this.currentX, this.currentY, totalSize, totalSize);

    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    
    const centerX = this.currentX + totalSize / 2;
    const centerY = this.currentY + totalSize / 2;
    const radius = (size - padding) / 2;

    this.ctx.beginPath();
    
    switch (shape) {
      case 'circle':
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        break;
      case 'square':
        this.ctx.rect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        break;
      case 'diamond':
        this.ctx.moveTo(centerX, centerY - radius);
        this.ctx.lineTo(centerX + radius, centerY);
        this.ctx.lineTo(centerX, centerY + radius);
        this.ctx.lineTo(centerX - radius, centerY);
        this.ctx.closePath();
        break;
      default:
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    }
    
    this.ctx.fill();
    this.ctx.stroke();

    const entry: VisualAtlasEntry = {
      x: this.currentX,
      y: this.currentY,
      width: totalSize,
      height: totalSize,
      colorizable: false
    };

    this.entries.set(cacheKey, entry);
    
    this.currentX += totalSize + padding;
    this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
    this.needsUpdate = true;

    return entry;
  }

  updateGPUTexture() {
    if (!this.needsUpdate || !this.texture) return;

    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas },
      { texture: this.texture },
      { width: this.ATLAS_SIZE, height: this.ATLAS_SIZE }
    );

    this.needsUpdate = false;
  }

  getEntry(key: string): VisualAtlasEntry | undefined {
    return this.entries.get(key);
  }

  getTexture(): GPUTexture | null {
    return this.texture;
  }

  getAtlasSize(): number {
    return this.ATLAS_SIZE;
  }

  clear() {
    this.entries.clear();
    this.imageCache.clear();
    this.currentX = 0;
    this.currentY = 0;
    this.currentRowHeight = 0;
    this.ctx.clearRect(0, 0, this.ATLAS_SIZE, this.ATLAS_SIZE);
    this.needsUpdate = true;
  }

  getStats() {
    return {
      totalEntries: this.entries.size,
      cachedImages: this.imageCache.size,
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

  destroy() {
    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }
    this.entries.clear();
    this.imageCache.clear();
  }
}