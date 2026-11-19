import { TextureAtlas } from './TextureAtlas';
import type { DiagramEdge, DiagramNode, Viewport } from '../types';
import { Z_LAYERS } from '../utils/DepthConstants';
import type { DiagramFont } from '../utils/FontLoadUtils';
import { declutter, labelWorldScale, LABEL_ATLAS_FONT_SIZE, LABEL_BOX_EM, type LabelCandidate } from './LabelScaling';
import { NEST_HEADER, boxLayout, compartmentOf, headerIcon, isBoxed, isRow, rowLayout } from '../utils/Nesting';
import { boundaryPoint } from '../utils/NodeGeometry';
import { MsdfFont } from './MsdfFont';
import { INTER_MSDF } from '../assets/fonts/interMsdf';

/**
 * The font labels use unless a node picks another: drawn from its MSDF atlas, so it's sharp at any
 * zoom. Other fonts, and text with characters the atlas lacks, are rasterised into the canvas atlas.
 */
const DEFAULT_LABEL_FONT: DiagramFont = 'Inter';
/** Floats per instance: texCoords, color, position and size, then params (see the shader). */
const INSTANCE_FLOATS = 16;

/** How far an end label sits along the edge from the node, and off to its side. */
const END_LABEL_ALONG = 18;
const END_LABEL_ASIDE = 10;

/**
 * One quad: a whole label from the canvas atlas, or one glyph from the MSDF atlas.
 * `msdf` holds the glyph atlas's distance range over its size (u and v); absent for canvas quads.
 */
export interface LabelInstanceData {
  texCoords: [number, number, number, number]; // UV coordinates in atlas (u1, v1, u2, v2)
  color: [number, number, number, number];     // Text color
  position: [number, number]; // World position (centre)
  size: [number, number]; // Size in world units
  msdf?: [number, number];
}

export class LabelRenderer {
  private device: GPUDevice;
  private textAtlas: TextureAtlas;
  private labelRenderPipeline: GPURenderPipeline | null = null;
  private labelBindGroup: GPUBindGroup | null = null;
  private labelBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer;
  private sampleCount: string;
  private readonly msdfFont = new MsdfFont(INTER_MSDF);
  /** Colour of text drawn on the canvas background (edge labels) unless an edge sets its own. */
  backgroundTextColor = '#ffffff';
  /** The MSDF atlas once loaded; until then every label goes through the canvas atlas. */
  private msdfTexture: GPUTexture | null = null;
  /** Bound in the MSDF atlas's place until it loads. */
  private placeholderTexture: GPUTexture | null = null;
  
  constructor(device: GPUDevice, uniformBuffer: GPUBuffer, sampleCount = '1') {
    this.device = device;
    this.uniformBuffer = uniformBuffer;
    this.textAtlas = new TextureAtlas(device);
    this.sampleCount = sampleCount;
  }

  async initialize(): Promise<boolean> {
    try {
    await this.setupLabelRenderPipeline();
    }
    catch (e) {
      return false;
    }
    // Not awaited: labels draw from the canvas atlas until the glyph atlas is ready.
    this.msdfFont.createTexture(this.device).then(texture => {
      this.msdfTexture = texture;
      this.updateBindGroup();
    }).catch(error => console.warn('MSDF label font failed to load; using canvas text', error));
    return true;
  }

  private async setupLabelRenderPipeline() {
    // Per-quad instance data: INSTANCE_FLOATS floats each
    this.labelBuffer = this.device.createBuffer({
      size: 4000 * INSTANCE_FLOATS * 4, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // All labels are drawn in one instanced call.
    const labelShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
      }

      // vec4s first, then vec2s, to satisfy storage-buffer alignment.
      struct LabelData {
        @align(16) texCoords: vec4<f32>, 
        @align(16) color: vec4<f32>,
        
        @align(8) position: vec2<f32>,
        @align(8) size: vec2<f32>,
        // x: 1 for an MSDF glyph, 0 for a canvas quad; yz: the glyph atlas's distance range / its size
        @align(16) params: vec4<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> labelData: array<LabelData>;
      @group(0) @binding(2) var textSampler: sampler;
      @group(0) @binding(3) var textAtlas: texture_2d<f32>;
      @group(0) @binding(4) var msdfAtlas: texture_2d<f32>;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) color: vec4<f32>,
        @location(2) @interpolate(flat) params: vec4<f32>,
      }

      @vertex
      fn vs_main(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) instanceIndex: u32
      ) -> VertexOutput {
        let positions = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        
      let uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0)
      );

        let label = labelData[instanceIndex];
        let localPos = positions[vertexIndex];
        let uv = uvs[vertexIndex];
        
        // Calculate world position for the label quad
        let worldPos = label.position + localPos * label.size * 0.5;
        
        // Map UV to atlas coordinates
        let atlasUV = mix(label.texCoords.xy, label.texCoords.zw, uv);
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${Z_LAYERS.LABELS} , 1.0);
        output.uv = atlasUV;
        output.color = label.color;
        output.params = label.params;
        
        return output;
      }

      fn median(r: f32, g: f32, b: f32) -> f32 {
        return max(min(r, g), min(max(r, g), b));
      }

      @fragment
      fn fs_main(
        @location(0) uv: vec2<f32>,
        @location(1) color: vec4<f32>,
        @location(2) @interpolate(flat) params: vec4<f32>
      ) -> @location(0) vec4<f32> {
        // Both atlases are sampled (and derivatives taken) before choosing, as WGSL wants them
        // in uniform control flow.
        let canvasSample = textureSample(textAtlas, textSampler, uv);
        let field = textureSample(msdfAtlas, textSampler, uv).rgb;
        // How many screen pixels the field's distance range covers here: the edge is
        // anti-aliased over one screen pixel whatever the zoom.
        let screenTexSize = vec2<f32>(1.0) / fwidth(uv);
        let screenPxRange = max(0.5 * dot(params.yz, screenTexSize), 1.0);
        let glyphAlpha = clamp(screenPxRange * (median(field.r, field.g, field.b) - 0.5) + 0.5, 0.0, 1.0);
        // The canvas atlas holds coverage in alpha; either way, tint it with the label colour.
        let coverage = select(canvasSample.a, glyphAlpha, params.x > 0.5);
        if (coverage < 0.01) {
          discard;
        }
        return vec4<f32>(color.rgb, coverage * color.a);
      }
    `;

    const labelShaderModule = this.device.createShaderModule({ code: labelShaderCode });

    const labelBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' as const }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' as const }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }
      ]
    });

    const labelPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [labelBindGroupLayout]
    });

    this.labelRenderPipeline = this.device.createRenderPipeline({
      label: 'label-render-pipeline',

      layout: labelPipelineLayout,
      vertex: {
        module: labelShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: labelShaderModule,
        entryPoint: 'fs_main',
        targets: [{ 
          format: navigator.gpu.getPreferredCanvasFormat(),
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        }]
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        // Labels share one z and are drawn last; writing depth would let one label's
        // anti-aliased fringe clip any label it overlaps.
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample: {count: parseInt(this.sampleCount)}
    });

    // No-op until the atlas texture exists; rebuilt when it does.
    this.updateBindGroup();
  }

  private updateBindGroup() {
    if (!this.labelRenderPipeline || !this.textAtlas.getTexture()) return;
    this.placeholderTexture ??= this.device.createTexture({
      label: 'msdf-atlas-placeholder', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING,
    });

    const textSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.labelBindGroup = this.device.createBindGroup({
      layout: this.labelRenderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.labelBuffer! } },
        { binding: 2, resource: textSampler },
        { binding: 3, resource: this.textAtlas.getTexture()!.createView() },
        { binding: 4, resource: (this.msdfTexture ?? this.placeholderTexture).createView() }
      ]
    });
  }

private hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
    const cleanHex = hex.replace('#', '');
    
    if (cleanHex.length === 8) {
      return {
        r: parseInt(cleanHex.substring(0, 2), 16) / 255,
        g: parseInt(cleanHex.substring(2, 4), 16) / 255,
        b: parseInt(cleanHex.substring(4, 6), 16) / 255,
        a: parseInt(cleanHex.substring(6, 8), 16) / 255,
      };
    } else if (cleanHex.length === 6) {
      return {
        r: parseInt(cleanHex.substring(0, 2), 16) / 255,
        g: parseInt(cleanHex.substring(2, 4), 16) / 255,
        b: parseInt(cleanHex.substring(4, 6), 16) / 255,
        a: 1.0,
      };
    } else {
      return { r: 0.23, g: 0.51, b: 0.96, a: 1.0 };
    }
  }

prepareLabelData(visibleNodes: DiagramNode[], visibleEdges: DiagramEdge[], viewport: Viewport): LabelInstanceData[] {
  const zoom = viewport.zoom;
  const pixelRatio = viewport.pixelRatio ?? 1;
  const scale = labelWorldScale(zoom, pixelRatio);
  const atlasSize = this.textAtlas.getAtlasSize();

  const degree = new Map<string, number>();
  for (const edge of visibleEdges) {
    degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
    degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const nodesById = new Map(visibleNodes.map(n => [n.id, n]));

  const candidates: LabelCandidate[] = [];
  const instances = new Map<string, LabelInstanceData[]>();
  const font = this.msdfFont, msdf = this.msdfTexture !== null;
  // World units per glyph-atlas pixel, and the glyph atlas's distance range over its size.
  const glyphScale = labelWorldScale(zoom, pixelRatio, font.data.size);
  const range: [number, number] = [font.data.distanceRange / font.data.width, font.data.distanceRange / font.data.height];

  /**
   * `x` is the label's centre, or its left or right end for those anchors; `alpha` fades it.
   * `spaced` text is laid out on its own lines (rows, compartments), so it needs no padding to keep apart.
   */
  const add = (id: string, priority: number, text: string, color: string, fontFamily: DiagramFont, x: number, y: number,
    anchor: 'center' | 'left' | 'right' = 'center', alpha = 1, spaced = false) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    try {
      const rgba = this.hexToRgba(color);
      rgba.a *= alpha;
      const tint: [number, number, number, number] = [rgba.r, rgba.g, rgba.b, rgba.a];
      if (fontFamily === DEFAULT_LABEL_FONT && msdf && font.covers(text)) {
        // A quad per glyph, on a line whose box is centred on y (the canvas atlas's box height, for declutter).
        const line = font.layout(text);
        const width = line.width * glyphScale;
        const height = LABEL_BOX_EM * font.data.size * glyphScale;
        const left = anchor === 'left' ? x : anchor === 'right' ? x - width : x - width / 2;
        const top = y - (font.data.lineHeight * glyphScale) / 2;
        candidates.push({ id, priority, x: left + width / 2, y, width, height, ...(spaced ? { padding: 0 } : {}) });
        instances.set(id, line.glyphs.map(({ glyph, left: gx, top: gy }) => ({
          texCoords: [glyph.x / font.data.width, glyph.y / font.data.height,
            (glyph.x + glyph.width) / font.data.width, (glyph.y + glyph.height) / font.data.height],
          color: tint,
          position: [left + (gx + glyph.width / 2) * glyphScale, top + (gy + glyph.height / 2) * glyphScale],
          size: [glyph.width * glyphScale, glyph.height * glyphScale],
          msdf: range,
        })));
        return;
      }
      const entry = this.textAtlas.addText(text, LABEL_ATLAS_FONT_SIZE, color, fontFamily);
      if (!entry) return;
      const width = entry.width * scale;
      const height = entry.height * scale;
      if (anchor === 'left') x += width / 2;
      else if (anchor === 'right') x -= width / 2;
      candidates.push({ id, priority, x, y, width, height, ...(spaced ? { padding: 0 } : {}) });
      instances.set(id, [{
        texCoords: [entry.x / atlasSize, entry.y / atlasSize, (entry.x + entry.width) / atlasSize, (entry.y + entry.height) / atlasSize],
        color: tint,
        position: [x, y],
        size: [width, height],
      }]);
    } catch (error) {
      console.error('Error preparing label:', text, error);
    }
  };

  for (const node of visibleNodes) {
    const label = node.data.label?.trim();
    if (!label) continue;
    // Selected nodes always win; otherwise well-connected nodes are the ones worth naming.
    const priority = (node.visual?.selected ? 1e6 : 0) + (degree.get(node.id) ?? 0);
    let { x, y } = node.data.position;
    const size = node.visual?.size;
    const color = node.visual?.labelColor || '#ffffffff';
    const nodeFont = (node.visual?.labelFont || DEFAULT_LABEL_FONT) as DiagramFont;
    if (isRow(node)) {
      // After the icon; the detail (e.g. the kind) faded at the right end, dropped first when they collide.
      const row = rowLayout(node);
      add(`n:${node.id}`, priority, label, color, nodeFont, row.labelLeft, y, 'left', 1, true);
      const detail = typeof node.visual?.detail === 'string' ? node.visual.detail.trim() : '';
      if (detail) add(`d:${node.id}`, priority - 0.5, detail, color, nodeFont, row.detailRight, y, 'right', 0.55, true);
      continue;
    }
    if (size && isBoxed(node)) {
      // In the header strip (right of a header icon, if any), and the compartment's lines under it.
      y += -size.height / 2 + NEST_HEADER / 2;
      if (headerIcon(node)) x += NEST_HEADER / 2;
      const box = boxLayout(node);
      compartmentOf(node).forEach((line, i) => {
        add(`c:${node.id}:${i}`, priority - 0.5, line, color, nodeFont, box.textLeft, box.lines[i], 'left', 0.85, true);
      });
    }
    add(`n:${node.id}`, priority, label, color, nodeFont, x, y);
  }

  for (const edge of visibleEdges) {
    // Text at the ends (a role and its multiplicity, say): near the node, beside the line.
    const source = nodesById.get(edge.sourceNodeId), target = nodesById.get(edge.targetNodeId);
    const ends: Array<[string, DiagramNode | undefined, { x: number; y: number } | undefined, unknown]> = [
      ['s', source, edge.userVertices[0] ?? target?.data.position, edge.data?.sourceLabel],
      ['t', target, edge.userVertices[edge.userVertices.length - 1] ?? source?.data.position, edge.data?.targetLabel],
    ];
    for (const [end, node, toward, text] of ends) {
      if (!node || !toward || typeof text !== 'string' || !text.trim()) continue;
      const at = boundaryPoint(node, { x: toward.x - node.data.position.x, y: toward.y - node.data.position.y });
      const length = Math.hypot(toward.x - at.x, toward.y - at.y) || 1;
      const d = { x: (toward.x - at.x) / length, y: (toward.y - at.y) / length };
      // To the line's left or right, whichever is up (or left, for a vertical line).
      let side = { x: d.y, y: -d.x };
      if (side.y > 0 || (side.y === 0 && side.x > 0)) side = { x: -side.x, y: -side.y };
      add(`${end}:${edge.id}`, -0.5, text.trim(), edge.style.labelColor || this.backgroundTextColor, DEFAULT_LABEL_FONT,
        at.x + d.x * END_LABEL_ALONG + side.x * END_LABEL_ASIDE, at.y + d.y * END_LABEL_ALONG + side.y * END_LABEL_ASIDE);
    }

    const label = edge.data?.label?.trim();
    if (!label) continue;
    let x: number, y: number;
    if (edge.userVertices.length > 0) {
      const mid = edge.userVertices[Math.floor(edge.userVertices.length / 2)];
      x = mid.x; y = mid.y;
    } else {
      if (!source || !target) continue;
      x = (source.data.position.x + target.data.position.x) / 2;
      y = (source.data.position.y + target.data.position.y) / 2;
    }
    // Below every node label, so edge labels only appear where there's room.
    add(`e:${edge.id}`, -1, label, edge.style.labelColor || this.backgroundTextColor, DEFAULT_LABEL_FONT, x, y);
  }

  const keep = declutter(candidates, zoom, 4 * pixelRatio);
  return candidates.filter(c => keep.has(c.id)).flatMap(c => instances.get(c.id)!);
}


  render(renderPass: GPURenderPassEncoder, labelData: LabelInstanceData[]): void {
    if (!this.labelRenderPipeline || !this.labelBuffer || labelData.length === 0) {
      return;
    }

    this.textAtlas.updateGPUTexture();

    // Prepare batched label data for GPU
    const flatLabelData = new Float32Array(labelData.length * INSTANCE_FLOATS);
    labelData.forEach((label, i) => {
      const offset = i * INSTANCE_FLOATS;
      // texCoords: vec4<f32>
      flatLabelData[offset + 0] = label.texCoords[0];
      flatLabelData[offset + 1] = label.texCoords[1];
      flatLabelData[offset + 2] = label.texCoords[2];
      flatLabelData[offset + 3] = label.texCoords[3];
      // color: vec4<f32>
      flatLabelData[offset + 4] = label.color[0];
      flatLabelData[offset + 5] = label.color[1];
      flatLabelData[offset + 6] = label.color[2];
      flatLabelData[offset + 7] = label.color[3];
      // position: vec2<f32>
      flatLabelData[offset + 8] = label.position[0];
      flatLabelData[offset + 9] = label.position[1];
      // size: vec2<f32>
      flatLabelData[offset + 10] = label.size[0];
      flatLabelData[offset + 11] = label.size[1];
      // params: vec4<f32>
      flatLabelData[offset + 12] = label.msdf ? 1 : 0;
      flatLabelData[offset + 13] = label.msdf?.[0] ?? 0;
      flatLabelData[offset + 14] = label.msdf?.[1] ?? 0;
    });

    // Resize label buffer if needed
    const requiredSize = labelData.length * INSTANCE_FLOATS * 4;
    if (requiredSize > this.labelBuffer.size) {
      this.labelBuffer.destroy();
      this.labelBuffer = this.device.createBuffer({
        size: requiredSize * 2, // Double for growth
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // Update bind group with new buffer
      this.updateBindGroup();
    }

    // Upload label data to GPU
    this.device.queue.writeBuffer(this.labelBuffer, 0, flatLabelData);

        renderPass.setPipeline(this.labelRenderPipeline);
    renderPass.setBindGroup(0, this.labelBindGroup!);
    renderPass.draw(6, labelData.length);

  }

  clearAtlas() {
    this.textAtlas.clear();
  }

  getAtlasStats() {
    return this.textAtlas.getStats();
  }

  getDebugCanvas(): HTMLCanvasElement {
    return this.textAtlas.getDebugCanvas();
  }

  destroy() {
    if (this.textAtlas) {
      this.textAtlas.destroy();
    }

    if (this.labelBuffer) {
      this.labelBuffer.destroy();
      this.labelBuffer = null;
    }
    this.msdfTexture?.destroy();
    this.placeholderTexture?.destroy();
    this.msdfTexture = this.placeholderTexture = null;

    this.labelRenderPipeline = null;
    this.labelBindGroup = null;
  }
}
