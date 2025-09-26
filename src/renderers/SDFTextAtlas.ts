import TinySDF from '@mapbox/tiny-sdf';

export interface SDFAtlasEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  glyphLeft: number;
  glyphTop: number;
  glyphAdvance: number;
}

export interface LayoutedGlyph {
  atlasEntry: SDFAtlasEntry;
  position: { x: number; y: number };
  char: string;
}

export class SDFTextAtlas {
  private sdf: TinySDF;
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private atlasTexture: GPUTexture;
  private glyphCache = new Map<string, SDFAtlasEntry>();
  
  private atlasWidth = 1024;
  private atlasHeight = 1024;
  private currentX = 0;
  private currentY = 0;
  private rowHeight = 0;
  private needsUpload = false;
  
  private baseFontSize: number;
  private buffer: number;

  constructor(device: GPUDevice, fontSize: number, buffer: number) {
    this.device = device;
    this.baseFontSize = fontSize;
    this.buffer = buffer;
    
    this.sdf = new TinySDF({
      fontSize,
      buffer: this.buffer,
      radius: 0.5,
      cutoff: 0.1,
      fontFamily: 'system-ui, -apple-system, sans-serif',  
      fontStyle: 'normal',    
      fontWeight: 'medium'
      }   
    );
    

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.atlasWidth;
    this.canvas.height = this.atlasHeight;
    this.ctx = this.canvas.getContext('2d')!;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 1)'
    this.ctx.fillRect(0, 0, this.atlasWidth, this.atlasHeight);
    
    this.atlasTexture = device.createTexture({
      size: { width: this.atlasWidth, height: this.atlasHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'sdf-text-atlas'
    });
  }

  getBaseFontSize() {
    return this.baseFontSize;
  }

  private findAtlasSpace(width: number, height: number): { x: number; y: number } | null {
    if (this.currentX + width > this.atlasWidth) {
      this.currentX = 0;
      this.currentY += this.rowHeight;
      this.rowHeight = 0;
    }
    
    if (this.currentY + height > this.atlasHeight) {
      console.warn('Atlas is full! Consider increasing size or clearing cache.');
      return null;
    }
    
    const position = { x: this.currentX, y: this.currentY };
    this.currentX += width;
    this.rowHeight = Math.max(this.rowHeight, height);
    
    return position;
  }

  addGlyph(char: string): SDFAtlasEntry | null {
    if (this.glyphCache.has(char)) {
      return this.glyphCache.get(char)!;
    }
    
    const sdfResult = this.sdf.draw(char);
    const { data, width, height, glyphWidth, glyphHeight, glyphTop, glyphLeft, glyphAdvance } = sdfResult;
    
    console.log(`SDF for '${char}':`, {
      width, height, glyphWidth, glyphHeight,
      dataLength: data.length,
      dataRange: { min: Math.min(...data), max: Math.max(...data) },
      sampleValues: Array.from(data.slice(0, 10)) 
    });
    
    const position = this.findAtlasSpace(width, height);
    if (!position) return null;
    
    const imageData = this.ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      const pixelIndex = i * 4;
      const distance = data[i];
      
      imageData.data[pixelIndex] = distance;     
      imageData.data[pixelIndex + 1] = distance;
      imageData.data[pixelIndex + 2] = distance; 
      imageData.data[pixelIndex + 3] = 255;     
    }
    
    this.ctx.putImageData(imageData, position.x, position.y);
    this.needsUpload = true;
    
    console.log(`Added '${char}' to atlas at (${position.x}, ${position.y})`);
    
    const entry: SDFAtlasEntry = {
      x: position.x,
      y: position.y,
      width: width,
      height: height,
      glyphLeft: glyphLeft,
      glyphTop: glyphTop,
      glyphAdvance: glyphAdvance
    };
    
    this.glyphCache.set(char, entry);
    return entry;
  }

  layoutText(text: string): LayoutedGlyph[] {
    const glyphs: LayoutedGlyph[] = [];
    let x = 0;
    const scale = this.baseFontSize;
    
    for (const char of text) {
      const atlasEntry = this.addGlyph(char);
      if (!atlasEntry) continue;
      
      glyphs.push({
        atlasEntry,
        position: { 
          x: x + (atlasEntry.glyphLeft * scale), 
          y: atlasEntry.glyphTop * scale 
        },
        char
      });
      
      x += atlasEntry.glyphAdvance * scale;
    }
    
    if (this.needsUpload) {
      this.uploadToGPU();
      this.needsUpload = false;
    }
    
    return glyphs;
  }

  private uploadToGPU() {
    const imageData = this.ctx.getImageData(0, 0, this.atlasWidth, this.atlasHeight);
    
    this.device.queue.writeTexture(
      { texture: this.atlasTexture },
      imageData.data,
      { 
        bytesPerRow: this.atlasWidth * 4,
        rowsPerImage: this.atlasHeight 
      },
      { width: this.atlasWidth, height: this.atlasHeight }
    );
  }

  getTexture(): GPUTexture {
    return this.atlasTexture;
  }

  getAtlasSize(): { width: number; height: number } {
    return { width: this.atlasWidth, height: this.atlasHeight };
  }

   debugSaveAtlas() {
    const link = document.createElement('a');
    link.download = 'sdf-atlas-debug.png';
    link.href = this.canvas.toDataURL();
    link.click();
  }

  debugTestAtlas() {
    console.log('Testing SDF atlas generation...');
    
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(10, 10, 50, 50);
    this.ctx.fillStyle = 'red'; 
    this.ctx.fillRect(70, 10, 30, 30);
    
    const testChars = ['A', 'B', 'C', '1', '2', '3'];
    for (const char of testChars) {
      this.addGlyph(char);
    }
    

    if (this.needsUpload) {
      this.uploadToGPU();
      this.needsUpload = false;
    }
    
    this.debugSaveAtlas();
  }

  clear() {
    this.glyphCache.clear();
    this.currentX = 0;
    this.currentY = 0;
    this.rowHeight = 0;
    
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.atlasWidth, this.atlasHeight);
    
    this.uploadToGPU();
  }

  destroy() {
    this.atlasTexture.destroy();
  }
}