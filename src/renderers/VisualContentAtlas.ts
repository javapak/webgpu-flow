import type { DiagramNode } from "../types";
import type { AlphaMask } from "../utils/NodeGeometry";

export interface VisualAtlasEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Empty border around the content, inside width and height. */
  padding: number;
  colorizable: boolean; // Track if this entry supports color tinting
  /** Coverage of the content (without the padding), for SVGs and images: where their outline is. */
  mask?: AlphaMask;
}

export class VisualContentAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: GPUTexture | null = null;
  private device: GPUDevice;
  private entries: Map<string, VisualAtlasEntry> = new Map();
  
  // Cache for loaded images
  private imageCache: Map<string, HTMLImageElement> = new Map();
  
  // Atlas configuration
  private readonly ATLAS_SIZE = 4096;
  /** Down to 1/16 scale: content stays smooth when zoomed out, and the entries' padding keeps neighbours apart. */
  private readonly MIP_LEVELS = 5;
  private mipPipeline: GPURenderPipeline | null = null;
  private mipSampler: GPUSampler | null = null;
  private currentX = 0;
  private currentY = 0;
  private currentRowHeight = 0;
  private needsUpdate = false;

  constructor(device: GPUDevice) {
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
      mipLevelCount: this.MIP_LEVELS,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: 1
    });
  }

  /** Hashes content without colour, so tinted copies share one atlas entry. */
  private hashContent(content: string, size: number): string {
    let hash = 5381;
    const fullString = `${content}-${size}`;
    for (let i = 0; i < fullString.length; i++) {
      hash = ((hash << 5) + hash + fullString.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  /**
   * Rewrites an SVG's fills and strokes to white, so the shader can tint it
   * by multiplying with the node colour.
   */
  private prepareSVGForColorTinting(svgString: string): string {
    let processedSvg = svgString.trim();
    
    
    // Replace fill attributes with white
    processedSvg = processedSvg.replace(/fill="[^"]*"/g, 'fill="white"');
    processedSvg = processedSvg.replace(/fill:[^;"]*/g, 'fill:white');
    processedSvg = processedSvg.replace(/stop-color:[^;"]*/g, 'stop-color:white');
    processedSvg = processedSvg.replace(/stop-color="[^"]*"/g, 'stop-color="white"');
    
    return processedSvg;
  }

  /** Loads an SVG string as an Image so it can be drawn into the atlas. */
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
   * Adds SVG content to the atlas.
   * @param colorizable - If true, the SVG is prepared for GPU colour tinting.
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
        padding,
        colorizable: colorizable,
        mask: this.maskAt(this.currentX + padding, this.currentY + padding, size),
      };

      this.entries.set(cacheKey, entry);
      
      this.currentX += totalSize + padding;
      this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
      this.needsUpdate = true;

      return entry;
    } catch (error) {
      console.error('Failed to add SVG to atlas:', error);
      return null;
    }
  }

  /** Adds an emoji to the atlas. */
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
      padding,
      colorizable: false
    };

    this.entries.set(cacheKey, entry);
    
    this.currentX += totalSize + padding;
    this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
    this.needsUpdate = true;

    return entry;
  }

  /** Adds an image from a URL to the atlas. */
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
        padding,
        colorizable: false,
        mask: this.maskAt(this.currentX + padding, this.currentY + padding, size),
      };

      this.entries.set(cacheKey, entry);
      
      this.currentX += totalSize + padding;
      this.currentRowHeight = Math.max(this.currentRowHeight, totalSize);
      this.needsUpdate = true;

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
      padding,
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

    // Premultiplied, so filtering and mipmaps don't pull in the (black) colour of transparent texels.
    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas },
      { texture: this.texture, premultipliedAlpha: true },
      { width: this.ATLAS_SIZE, height: this.ATLAS_SIZE }
    );
    this.generateMipmaps(this.texture);

    this.needsUpdate = false;
  }

  /** Fills each mip level by filtering the one above it. */
  private generateMipmaps(texture: GPUTexture) {
    if (!this.mipPipeline) {
      const module = this.device.createShaderModule({
        label: 'visual-atlas-mipmaps',
        code: /* wgsl */`
          @group(0) @binding(0) var source: texture_2d<f32>;
          @group(0) @binding(1) var sourceSampler: sampler;

          struct VertexOutput {
            @builtin(position) position: vec4<f32>,
            @location(0) uv: vec2<f32>,
          }

          // One triangle covering the target level.
          @vertex
          fn vs_main(@builtin(vertex_index) i: u32) -> VertexOutput {
            let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
            var output: VertexOutput;
            output.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
            output.uv = uv;
            return output;
          }

          @fragment
          fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
            return textureSample(source, sourceSampler, input.uv);
          }
        `,
      });
      this.mipPipeline = this.device.createRenderPipeline({
        label: 'visual-atlas-mipmaps',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format: texture.format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.mipSampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    }

    const encoder = this.device.createCommandEncoder({ label: 'visual-atlas-mipmaps' });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const bindGroup = this.device.createBindGroup({
        layout: this.mipPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: this.mipSampler! },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(this.mipPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }

  /** The alpha of a just-drawn region, or undefined when the canvas can't be read (a cross-origin image). */
  private maskAt(x: number, y: number, size: number): AlphaMask | undefined {
    try {
      const { data } = this.ctx.getImageData(x, y, size, size);
      const alpha = new Uint8Array(size * size);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      return { width: size, height: size, alpha };
    } catch {
      return undefined;
    }
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