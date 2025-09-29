import type { DiagramNode } from "../types";

export interface VisualAtlasEntry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class VisualContentAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: GPUTexture | null = null;
  private device: GPUDevice;
  private entries: Map<string, VisualAtlasEntry> = new Map();
  
  // Atlas configuration
  private readonly ATLAS_SIZE = 1024; // Keep it simple like TextureAtlas
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
    
    // High quality rendering
    this.ctx.textRendering = 'optimizeLegibility';
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.filter = 'blur(1)'

    
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
    });
  }

   private hashSvgContent(svgContent: string): string {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < svgContent.length; i++) {
      hash ^= svgContent.charCodeAt(i);
      hash = (hash * 16777619) >>> 0; // FNV prime, force to 32-bit unsigned
    }
    return hash.toString(36); // Base 36 for shorter strings
  }
  
  /* private hashImageUrl(imageUrl: string): string {
    // djb2 hash
    let hash = 5381;
    for (let i = 0; i < imageUrl.length; i++) {
      hash = ((hash << 5) + hash + imageUrl.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  } */

  // Simple emoji/text rendering (synchronous)
  addEmoji(emoji: string, size: number = 64, node: DiagramNode): VisualAtlasEntry | null {
    const cacheKey = `emoji:${node.visual!.visualContent!.content as string}`;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    node.visual!.cacheKey = cacheKey;

    const padding = 4;
    const totalSize = size + padding * 2;

    // Check if we need to move to next row
    if (this.currentX + totalSize > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + padding;
      this.currentRowHeight = 0;
    }

    if (this.currentY + totalSize > this.ATLAS_SIZE) {
      console.warn('Visual atlas is full!');
      return null;
    }

    // Clear the area
    this.ctx.clearRect(this.currentX, this.currentY, totalSize, totalSize);

    // Draw emoji
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
      height: totalSize
    };

    this.entries.set(cacheKey, entry);
    
    // Update position tracking
    this.currentX += totalSize + padding;
    this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
    this.needsUpdate = true;

    console.log(`Added emoji "${emoji}" to atlas at (${entry.x}, ${entry.y})`);
    return entry;
  }

  getEntry(key: string): VisualAtlasEntry | undefined {
    if (this.entries.has(key)) return this.entries.get(key);
  }

  // Simple colored shape rendering (synchronous)
  addColoredShape(shape: string, color: string, size: number = 64, node: DiagramNode): VisualAtlasEntry | null {
    const cacheKey = `svg:${this.hashSvgContent(node.visual!.visualContent!.content)}`;
    node.visual!.cacheKey = cacheKey;
    
    if (this.entries.has(cacheKey)) {
      return this.entries.get(cacheKey)!;
    }

    const padding = 4;
    const totalSize = size + padding * 2;

    // Check if we need to move to next row
    if (this.currentX + totalSize > this.ATLAS_SIZE) {
      this.currentX = 0;
      this.currentY += this.currentRowHeight + padding;
      this.currentRowHeight = 0;
    }

    if (this.currentY + totalSize > this.ATLAS_SIZE) {
      console.warn('Visual atlas is full!');
      return null;
    }

    // Clear the area
    this.ctx.clearRect(this.currentX, this.currentY, totalSize, totalSize);

    // Draw simple shapes
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
        // Default to circle
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    }
    
    this.ctx.fill();
    this.ctx.stroke();

    const entry: VisualAtlasEntry = {
      x: this.currentX,
      y: this.currentY,
      width: totalSize,
      height: totalSize
    };

    this.entries.set(cacheKey, entry);
    
    // Update position tracking
    this.currentX += totalSize + padding;
    this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
    this.needsUpdate = true;

    console.log(`Added ${shape} to atlas at (${entry.x}, ${entry.y})`);
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
    return {
      totalEntries: this.entries.size,
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
  }
}