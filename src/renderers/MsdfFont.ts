// A multi-channel signed distance field (MSDF) font: glyph metrics, kerning and the
// atlas texture. Text drawn from it stays sharp at any size, since the shader
// rebuilds each glyph's edge from distances rather than scaling a bitmap.

/** A font as scripts/msdf-font.mjs packs it. Sizes are atlas pixels at `size` px per em. */
export interface MsdfFontData {
  name: string;
  /** Pixels per em the atlas was generated at. */
  size: number;
  lineHeight: number;
  /** Baseline, down from the top of the line. */
  base: number;
  /** Distance, in atlas pixels, the field spans from inside to outside an edge. */
  distanceRange: number;
  width: number;
  height: number;
  /** [code point, x, y, width, height, xoffset, yoffset, xadvance] */
  glyphs: number[][];
  /** [first, second, amount] */
  kernings: number[][];
  /** The atlas, base64 PNG. */
  png: string;
}

export interface MsdfGlyph {
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

/** One glyph placed on a line, in atlas pixels from the line's top-left. */
export interface PlacedGlyph {
  glyph: MsdfGlyph;
  left: number;
  top: number;
}

export class MsdfFont {
  private readonly glyphs = new Map<number, MsdfGlyph>();
  private readonly kerning = new Map<number, number>();

  constructor(readonly data: MsdfFontData) {
    for (const [id, x, y, width, height, xoffset, yoffset, xadvance] of data.glyphs) {
      this.glyphs.set(id, { x, y, width, height, xoffset, yoffset, xadvance });
    }
    for (const [first, second, amount] of data.kernings) this.kerning.set(pairKey(first, second), amount);
  }

  /** Whether every character of `text` is in the atlas. */
  covers(text: string): boolean {
    for (const ch of text) if (!this.glyphs.has(ch.codePointAt(0)!)) return false;
    return true;
  }

  /** `text` on one line: each glyph's place (spaces take room but draw nothing), and the line's advance width. */
  layout(text: string): { glyphs: PlacedGlyph[]; width: number } {
    const glyphs: PlacedGlyph[] = [];
    let pen = 0;
    let previous: number | undefined;
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      const glyph = this.glyphs.get(code);
      if (!glyph) continue;
      if (previous !== undefined) pen += this.kerning.get(pairKey(previous, code)) ?? 0;
      if (glyph.width > 0 && glyph.height > 0) glyphs.push({ glyph, left: pen + glyph.xoffset, top: glyph.yoffset });
      pen += glyph.xadvance;
      previous = code;
    }
    return { glyphs, width: pen };
  }

  /**
   * The atlas as a texture. Distances aren't colours: no colour-space conversion or
   * premultiplication on the way in, and a linear (not sRGB) format.
   */
  async createTexture(device: GPUDevice): Promise<GPUTexture> {
    const bytes = Uint8Array.from(atob(this.data.png), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const texture = device.createTexture({
      label: `msdf-atlas-${this.data.name}`,
      size: [bitmap.width, bitmap.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    bitmap.close();
    return texture;
  }
}

function pairKey(first: number, second: number): number {
  return first * 0x110000 + second;
}
