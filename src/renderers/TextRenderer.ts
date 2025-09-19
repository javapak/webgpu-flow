import {} from "typegpu";
export default class TextRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
    this.canvas = document.createElement('canvas');

    this.ctx = this.canvas.getContext('2d')!;
  }

  createTextTexture(text: string, fontSize: number = 16, color: string = '#000'): { texture: GPUTexture, width: number, height: number } {
    // Set canvas size based on text
    this.ctx.font = `bold ${fontSize}px Calibri`;
    const metrics = this.ctx.measureText(text);
    const width = Math.ceil(metrics.width + 20); // Add padding
    const height = Math.ceil(fontSize * 1.8); // Add vertical padding

    this.canvas.width = width;
    this.canvas.height = height;

    // Clear and render text
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.font = `bold ${fontSize}px `;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    // Add text shadow for better visibility
    this.ctx.shadowColor = 'rgba(0, 0, 0, 1)';
    this.ctx.shadowBlur = 1.5;
    this.ctx.shadowOffsetX = 2;
    this.ctx.shadowOffsetY = 2;
    
    this.ctx.fillText(text, width / 2, height / 2);

    // Create WebGPU texture from canvas
   const texture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Copy canvas data to texture
    this.device.queue.copyExternalImageToTexture(
      { source: this.canvas },
      { texture },
      {width, height}
    );

    return { texture, width, height };
  }
}
