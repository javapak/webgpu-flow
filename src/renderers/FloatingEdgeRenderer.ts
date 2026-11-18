import type { EdgeDrawingState } from '../components/DiagramProvider';
import type { DiagramEdge, DiagramNode } from '../types';
import { Z_LAYERS, edgeZ, markerZ } from '../utils/DepthConstants';
import { boxOf, isRow, nestingOf } from '../utils/Nesting';

type Point = { x: number; y: number };
/** An edge's spread ends, and how far apart the ends on their sides are (which limits marker size). */
type Ports = { source?: Point; target?: Point; sourceRoom?: number; targetRoom?: number };
/** Closest that ends on one side of a node may sit (a marker is 14 across), and how far from its corners. */
const PORT_GAP = 16;
const PORT_INSET = 4;
/** A hop's half-width (and height), the segments its arc is drawn with, and where finding them stops. */
const HOP_RADIUS = 6;
const HOP_STEPS = 8;
const MAX_HOP_SEGMENTS = 3000;

/** Where segments ab and cd cross, as fractions along each, strictly inside both; null if they don't. */
function crossing(a: Point, b: Point, c: Point, d: Point): { t: number; u: number } | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;   // parallel
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { t, u } : null;
}
import { boundaryPoint } from '../utils/NodeGeometry';

// Marker type definitions
export type MarkerType = 
  // UML Association markers
  | 'none'
  | 'arrow'                    
  | 'open-arrow'              
  | 'filled-arrow'            
  | 'diamond'                
  | 'filled-diamond'          
  | 'circle'                 
  | 'cross'                   
  
  // Database relationship markers
  | 'crow-foot'                
  | 'crow-foot-optional'       
  | 'crow-foot-mandatory'     
  | 'one'                     
  | 'one-optional'            
  | 'many-optional'           
  
  // OCL/Constraint markers
  | 'constraint'               
  | 'inheritance'              
  | 'realization'             
  
  // Additional useful markers
  | 'double-arrow'            
  | 'bar'                      
  | 'dot'                      
  | 'square'                   
  | 'filled-square';          

export interface EdgeStyle {
  color: [number, number, number, number];
  thickness: number;
  dashPattern?: number[];
  sourceMarker?: MarkerType;
  targetMarker?: MarkerType;
  labelColor?: string;
}

export interface FloatingEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  userVertices: Array<{x: number, y: number}>;
  style: EdgeStyle;
}

export class FloatingEdgeRenderer {
  /** Lines with hops this frame, by edge ID (see findHops). */
  private hops = new Map<string, Point[]>();
  /** Spread edge ends this frame, by edge ID (see spreadEnds). */
  private ports = new Map<string, Ports>();
  private device!: GPUDevice;
  private edgeBuffer!: GPUBuffer;
  private markerBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private vertexHandleBuffer!: GPUBuffer;
  private renderPipeline!: GPURenderPipeline;
  private markerPipeline!: GPURenderPipeline;
  private handleRenderPipeline!: GPURenderPipeline;
  private bindGroup!: GPUBindGroup;
  private markerBindGroup!: GPUBindGroup;
  private handleBindGroup!: GPUBindGroup;  
  private maxVerticesPerEdge: number;
  private maxEdges: number;
  private sampleCount: string;
  
  constructor(
    device: GPUDevice, 
    format: GPUTextureFormat = 'bgra8unorm',
    maxVerticesPerEdge = 20, 
    maxEdges = 1000,
    sampleCount = '1'
  ) {
    this.device = device;
    this.maxVerticesPerEdge = maxVerticesPerEdge;
    this.maxEdges = maxEdges;
    this.sampleCount = sampleCount;
    
    this.createBuffers();
    this.createPipeline(format);
    this.createMarkerPipeline(format);
    this.createHandlePipeline(format);
    this.createBindGroup();
  }
  
  private createBuffers() {
    const verticesPerSegment = 6;
    const bufferSize = this.maxEdges * this.maxVerticesPerEdge * verticesPerSegment * 8 * 4;
    
    this.edgeBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'floating-edge-buffer'
    });
    
    // Marker instances
    this.markerBuffer = this.device.createBuffer({
      size: this.maxEdges * 2 * 64, // 2 markers per edge, 16 floats (64 bytes) each
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'edge-marker-buffer'
    });
    
    this.vertexHandleBuffer = this.device.createBuffer({
      size: this.maxVerticesPerEdge * this.maxEdges * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'edge-vertex-handle-buffer'
    });
    
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'edge-uniforms'
    });
  }

  private createBindGroup() {
    this.bindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        }
      ],
      label: 'edge-bind-group'
    });
    
    this.markerBindGroup = this.device.createBindGroup({
      layout: this.markerPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        },
        {
          binding: 1,
          resource: { buffer: this.markerBuffer }
        }
      ],
      label: 'marker-bind-group'
    });
    
    this.handleBindGroup = this.device.createBindGroup({
      layout: this.handleRenderPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        },
        {
          binding: 1,
          resource: { buffer: this.vertexHandleBuffer }
        }
      ],
      label: 'edge-handle-bind-group'
    });
  }

  private createHandlePipeline(format: GPUTextureFormat) {
    const handleShaderCode = `
      struct Uniforms {
        viewProjection: mat4x4<f32>,
      }
      
      struct HandleData {
        position: vec2<f32>,
        size: vec2<f32>,
        color: vec4<f32>,
      }
      
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> handleData: array<HandleData>;
      
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
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
        
        let handle = handleData[instanceIndex];
        let localPos = positions[vertexIndex];
        let worldPos = handle.position + localPos * handle.size * 0.5;
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${Z_LAYERS.HANDLES}, 1.0);
        output.color = handle.color;
        output.uv = uvs[vertexIndex];
        
        return output;
      }
      
      @fragment
      fn fs_main(
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>
      ) -> @location(0) vec4<f32> {
        let center = abs(uv - 0.5) * 2.0;
        let diamond = center.x + center.y;
        
        let edgeWidth = 0.1;
        let alpha = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, diamond);
        
        if (alpha < 0.01) {
          discard;
        }
        
        let borderWidth = 0.15;
        let innerDiamond = (center.x + center.y) / (1.0 - borderWidth);
        let borderAlpha = smoothstep(0.9, 1.0, innerDiamond);
        
        let borderColor = vec4<f32>(0.1, 0.1, 0.1, 1.0);
        let finalColor = mix(color, borderColor, borderAlpha);
        
        return vec4<f32>(finalColor.rgb, alpha);
      }
    `;
    
    const handleShaderModule = this.device.createShaderModule({
      code: handleShaderCode,
      label: 'edge-vertex-handle-shader'
    });
    
    this.handleRenderPipeline = this.device.createRenderPipeline({
      label: 'edge-vertex-handle-pipeline',
      layout: 'auto',
      vertex: {
        module: handleShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: handleShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        
        depthCompare: 'less',
      },
      multisample: {count: parseInt(this.sampleCount)}
    });
  }
  
  private createPipeline(format: GPUTextureFormat) {
    const shaderModule = this.device.createShaderModule({
      code: `
        struct VertexInput {
          @location(0) position: vec2<f32>,
          @location(1) color: vec4<f32>,
          @location(2) depth: f32,     // z of the edge's nesting band (see DepthConstants.edgeZ)
        }
        
        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) color: vec4<f32>,
          @location(1) uv: vec2<f32>,
        }
        
        struct Uniforms {
          viewProjection: mat4x4<f32>,
        }
        
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        
        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = uniforms.viewProjection * vec4<f32>(input.position, input.depth, 1.0);
          output.color = input.color;
          output.uv = vec2<f32>(0.0, 0.0);
          return output;
        }
        
        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          return input.color;
        }
      `,
      label: 'edge-shader'
    });
    
    this.renderPipeline = this.device.createRenderPipeline({
      label: 'edge-render-pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x4' },
            { shaderLocation: 2, offset: 24, format: 'float32' },   // then one float of padding
          ]
        }]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: {count: parseInt(this.sampleCount) }
    });
  }
  
private createMarkerPipeline(format: GPUTextureFormat) {

    const markerShaderCode = `
      struct Uniforms {
        viewProjection: mat4x4<f32>,
      }
      
      struct MarkerData {
        position: vec2<f32>,      // offset 0-8
        direction: vec2<f32>,     // offset 8-16
        size: f32,                // offset 16-20
        markerType: f32,          // offset 20-24
        depth: f32,               // offset 24-28: z, over the node it touches
        padding1: f32,            // offset 28-32 (padding to align next vec4)
        color: vec4<f32>,         // offset 32-48 (16-byte aligned)
        padding2: vec2<f32>,      // offset 48-56
        padding3: vec2<f32>,      // offset 56-64 -> make total struct size 64 bytes (16 floats)

    }
      
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> markerData: array<MarkerData>;
      
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) markerType: f32,
        @location(3) direction: vec2<f32>,
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
        
        let marker = markerData[instanceIndex];
        let localPos = positions[vertexIndex];
        
        // Rotate to align with direction
        let angle = atan2(marker.direction.y, marker.direction.x);
        let cosA = cos(angle);
        let sinA = sin(angle);
        let rotated = vec2<f32>(
          localPos.x * cosA - localPos.y * sinA,
          localPos.x * sinA + localPos.y * cosA
        );
        
        let worldPos = marker.position + rotated * marker.size;
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, marker.depth, 1.0);
        output.color = marker.color;
        output.uv = uvs[vertexIndex];
        output.markerType = marker.markerType;
        output.direction = marker.direction;
        
        return output;
      }
    @fragment
    fn fs_main(
      @location(0) color: vec4<f32>,
      @location(1) uv: vec2<f32>,
      @location(2) markerType: f32,
      @location(3) direction: vec2<f32>
    ) -> @location(0) vec4<f32> {
      let centered = uv - 0.5;
      var alpha = 0.0;
      
      let type_int = i32(markerType + 0.5);
      
      switch(type_int) {
        case 1, 3: { // arrow / filled-arrow
          let tipX = 0.4;
          let baseX = -0.4;
          let baseHalfHeight = 0.4;
          let xProgress = (centered.x - baseX) / (tipX - baseX);
          let allowedHalfHeight = baseHalfHeight * (1.0 - xProgress);
          let inYBounds = abs(centered.y) <= allowedHalfHeight;
          let inXBounds = centered.x >= baseX && centered.x <= tipX;
          alpha = select(0.0, 1.0, inXBounds && inYBounds);
        }
        case 2, 12: { // open-arrow / inheritance
          let tipX = 0.4;
          let baseX = -0.4;
          let baseHalfHeight = 0.4;
          
          // Outer triangle
          let xProgressOuter = (centered.x - baseX) / (tipX - baseX);
          let allowedHalfHeightOuter = baseHalfHeight * (1.0 - xProgressOuter);
          let inYBoundsOuter = abs(centered.y) <= allowedHalfHeightOuter;
          let inXBoundsOuter = centered.x >= baseX && centered.x <= tipX;
          let outer = inXBoundsOuter && inYBoundsOuter;
          
          // Inner triangle
          let tipXInner = 0.3;
          let baseXInner = -0.3;
          let baseHalfHeightInner = 0.3;
          let xProgressInner = (centered.x - baseXInner) / (tipXInner - baseXInner);
          let allowedHalfHeightInner = baseHalfHeightInner * (1.0 - xProgressInner);
          let inYBoundsInner = abs(centered.y) <= allowedHalfHeightInner;
          let inXBoundsInner = centered.x >= baseXInner && centered.x <= tipXInner;
          let inner = inXBoundsInner && inYBoundsInner;
          
          alpha = select(0.0, 1.0, outer && !inner);
        }
        case 4: { // diamond (hollow)
          let diamondDist = abs(centered.x) + abs(centered.y);
          let outer = diamondDist < 0.45;
          let inner = diamondDist < 0.32;
          alpha = select(0.0, 1.0, outer && !inner);
        }
        case 5: { // filled-diamond
          let diamondDist = abs(centered.x) + abs(centered.y);
          alpha = select(0.0, 1.0, diamondDist < 0.45);
        }
        case 6, 11: { // circle / one-optional (hollow circle)
          let dist = length(centered);
          let outer = dist < 0.4;
          let inner = dist < 0.28;
          alpha = select(0.0, 1.0, outer && !inner);
        }
        case 7: { // cross
          let horizontal = abs(centered.y) < 0.06;
          let vertical = abs(centered.x) < 0.06;
          alpha = select(0.0, 1.0, horizontal || vertical);
        }
        case 8: { // crow-foot (three lines converging)
          let thickness = 0.04;
          let line1 = abs(centered.y - 0.25) < thickness && centered.x > -0.4 && centered.x < 0.2;
          let line2 = abs(centered.y) < thickness && centered.x > -0.4 && centered.x < 0.2;
          let line3 = abs(centered.y + 0.25) < thickness && centered.x > -0.4 && centered.x < 0.2;
          alpha = select(0.0, 1.0, line1 || line2 || line3);
        }
        case 9: { // crow-foot-optional (with circle)
          let thickness = 0.04;
          let circleDist = length(centered - vec2<f32>(-0.25, 0.0));
          let hasCircle = circleDist < 0.12;
          let line1 = abs(centered.y - 0.25) < thickness && centered.x > 0.0 && centered.x < 0.4;
          let line2 = abs(centered.y) < thickness && centered.x > 0.0 && centered.x < 0.4;
          let line3 = abs(centered.y + 0.25) < thickness && centered.x > 0.0 && centered.x < 0.4;
          alpha = select(0.0, 1.0, hasCircle || line1 || line2 || line3);
        }
        case 10, 14: { // one / bar (single vertical line)
          alpha = select(0.0, 1.0, abs(centered.x + 0.35) < 0.06 && abs(centered.y) < 0.4);
        }
        case 13: { // double-arrow (two triangles back-to-back)
          // Right-pointing triangle
          let tipXR = 0.4;
          let baseXR = 0.0;
          let xProgressR = (centered.x - baseXR) / (tipXR - baseXR);
          let allowedHalfHeightR = 0.4 * (1.0 - xProgressR);
          let inXBoundsR = centered.x >= baseXR && centered.x <= tipXR;
          let tri1 = inXBoundsR && abs(centered.y) <= allowedHalfHeightR;
          
          // Left-pointing triangle
          let tipXL = -0.4;
          let baseXL = 0.0;
          let xProgressL = (baseXL - centered.x) / (baseXL - tipXL);
          let allowedHalfHeightL = 0.4 * (1.0 - xProgressL);
          let inXBoundsL = centered.x <= baseXL && centered.x >= tipXL;
          let tri2 = inXBoundsL && abs(centered.y) <= allowedHalfHeightL;
          
          alpha = select(0.0, 1.0, tri1 || tri2);
        }
        case 15: { // dot (filled circle)
          let dist = length(centered);
          alpha = select(0.0, 1.0, dist < 0.2);
        }
        case 16: { // square (hollow)
          let outer = abs(centered.x) < 0.4 && abs(centered.y) < 0.4;
          let inner = abs(centered.x) < 0.28 && abs(centered.y) < 0.28;
          alpha = select(0.0, 1.0, outer && !inner);
        }
        case 17: { // filled-square
          alpha = select(0.0, 1.0, abs(centered.x) < 0.4 && abs(centered.y) < 0.4);
        }
        default: { // fallback: filled circle
          let dist = length(centered);
          alpha = select(0.0, 1.0, dist < 0.35);
        }
      }

      // Outside the marker: write nothing, not even depth, or the quad's empty corners would hide
      // whatever is drawn behind them later (a node's SVG or image content) and show the grid.
      if (alpha < 0.01) {
        discard;
      }
      // Use premultiplied alpha.
      return vec4<f32>(color.rgb * alpha, alpha);
    }

    `;
    
    const markerShaderModule = this.device.createShaderModule({
      code: markerShaderCode,
      label: 'marker-shader'
    });
    
    this.markerPipeline = this.device.createRenderPipeline({
      label: 'marker-pipeline',
      layout: 'auto',
      vertex: {
        module: markerShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: markerShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: format,
          blend: {
            color: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,     
        depthCompare: 'less',         
      },
      multisample: {count: parseInt(this.sampleCount)}
    });
  }

  private getMarkerTypeValue(type: MarkerType): number {
    const markerMap: Record<MarkerType, number> = {
      'none': 0,
      'arrow': 1,
      'open-arrow': 2,
      'filled-arrow': 3,
      'diamond': 4,
      'filled-diamond': 5,
      'circle': 6,
      'cross': 7,
      'crow-foot': 8,
      'crow-foot-optional': 9,
      'crow-foot-mandatory': 8, 
      'one': 10,
      'one-optional': 11,
      'many-optional': 9, 
      'constraint': 2, 
      'inheritance': 12,
      'realization': 12, 
      'double-arrow': 13,
      'bar': 14,
      'dot': 15,
      'square': 16,
      'filled-square': 17
    };
    
    return markerMap[type] || 0;
  }
  
  /** Two triangles per segment; 8 floats per vertex: position, colour, depth, padding. */
  private generateLineStripGeometry(
    vertices: Array<{x: number, y: number}>, 
    style: EdgeStyle,
    depth: number
  ): Float32Array {
    if (vertices.length < 2) return new Float32Array(0);
    
    const geometry: number[] = [];
    const thickness = style.thickness;
    const color = style.color;
    
    for (let i = 0; i < vertices.length - 1; i++) {
      const p1 = vertices[i];
      const p2 = vertices[i + 1];
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      const nx = -dy / length * thickness * 0.5;
      const ny = dx / length * thickness * 0.5;
      
      const segmentVerts = [
        p1.x + nx, p1.y + ny, ...color, depth, 0,
        p1.x - nx, p1.y - ny, ...color, depth, 0,
        p2.x + nx, p2.y + ny, ...color, depth, 0,
        
        p1.x - nx, p1.y - ny, ...color, depth, 0,
        p2.x - nx, p2.y - ny, ...color, depth, 0,
        p2.x + nx, p2.y + ny, ...color, depth, 0,
      ];
      
      geometry.push(...segmentVerts);
    }
    
    return new Float32Array(geometry);
  }

  /**
   * Where the edge leaves its source and meets its target, on their outlines. Each end aims at
   * the next point along the edge. A row's end is at its left or right side (see NodeGeometry),
   * so without bend points the other end aims at that side rather than at the row's centre.
   */
  private endpoints(edge: FloatingEdge, nodes: DiagramNode[]) {
    const sourceNode = nodes.find(node => node.id === edge.sourceNodeId);
    const targetNode = nodes.find(node => node.id === edge.targetNodeId);
    const first = edge.userVertices[0], last = edge.userVertices[edge.userVertices.length - 1];
    const towards = (node: DiagramNode, p: { x: number; y: number }) =>
      boundaryPoint(node, { x: p.x - node.data.position.x, y: p.y - node.data.position.y });
    if (!sourceNode || (!targetNode && !first)) return null;
    if (!targetNode) return { sourceNode, sourcePoint: towards(sourceNode, first) };

    let sourcePoint = towards(sourceNode, first ?? targetNode.data.position);
    let targetPoint = towards(targetNode, last ?? sourceNode.data.position);
    if (!first) {
      if (isRow(sourceNode) && !isRow(targetNode)) targetPoint = towards(targetNode, sourcePoint);
      else if (isRow(targetNode) && !isRow(sourceNode)) sourcePoint = towards(sourceNode, targetPoint);
    }
    const port = this.ports.get(edge.id);
    return { sourceNode, targetNode, sourcePoint: port?.source ?? sourcePoint, targetPoint: port?.target ?? targetPoint };
  }

  /**
   * Where edges cross, one hops over the other with a small arc, as in circuit diagrams, so a
   * crossing never reads as a junction. The more horizontal line hops (the later edge, if they're
   * as steep); the arc bulges up, or to the same side on slanted lines. Crossings near a corner or
   * an end are left alone. Returns the lines of the edges that hop, with their arcs, by edge ID.
   */
  private findHops(edges: FloatingEdge[], nodes: DiagramNode[]): Map<string, Point[]> {
    const lines: Array<{ id: string; points: Point[] }> = [];
    for (const edge of edges) {
      const e = this.endpoints(edge, nodes);
      if (e?.targetPoint) lines.push({ id: edge.id, points: [e.sourcePoint, ...edge.userVertices, e.targetPoint] });
    }
    const segments = lines.flatMap((line, l) => line.points.slice(1).map((b, i) => ({ l, i, a: line.points[i], b })));
    const hops = new Map<string, Point[]>();
    if (segments.length > MAX_HOP_SEGMENTS) return hops;

    // Where along each hopping segment (0..1) its hops are, by line and segment.
    const at = new Map<string, number[]>();
    for (let s = 0; s < segments.length; s++) {
      for (let k = s + 1; k < segments.length; k++) {
        const p = segments[s], q = segments[k];
        if (p.l === q.l) continue;
        const cross = crossing(p.a, p.b, q.a, q.b);
        if (!cross) continue;
        const steep = (g: typeof p) => Math.abs(g.b.y - g.a.y) / (Math.abs(g.b.x - g.a.x) + Math.abs(g.b.y - g.a.y));
        const hopper = steep(p) < steep(q) ? { g: p, t: cross.t } : { g: q, t: cross.u };
        const length = Math.hypot(hopper.g.b.x - hopper.g.a.x, hopper.g.b.y - hopper.g.a.y);
        // Not where the hop would run into a corner or an end.
        if (hopper.t * length < 2 * HOP_RADIUS || (1 - hopper.t) * length < 2 * HOP_RADIUS) continue;
        const key = `${hopper.g.l}:${hopper.g.i}`;
        (at.get(key) ?? at.set(key, []).get(key)!).push(hopper.t);
      }
    }
    if (at.size === 0) return hops;

    lines.forEach((line, l) => {
      if (![...at.keys()].some(k => k.startsWith(`${l}:`))) return;
      const out: Point[] = [line.points[0]];
      for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1], b = line.points[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
        // The side the arc bulges to: up, or for a vertical line, left.
        let normal = { x: d.y, y: -d.x };
        if (normal.y > 0 || (normal.y === 0 && normal.x > 0)) normal = { x: -normal.x, y: -normal.y };
        let last = -Infinity;
        for (const t of (at.get(`${l}:${i - 1}`) ?? []).sort((x, y) => x - y)) {
          const s = t * length;
          if (s - last < 2.5 * HOP_RADIUS) continue;   // too close to the previous hop: one is enough
          last = s;
          const c = { x: a.x + d.x * s, y: a.y + d.y * s };
          for (let j = 0; j <= HOP_STEPS; j++) {
            const phi = (Math.PI * j) / HOP_STEPS;
            out.push({
              x: c.x - d.x * HOP_RADIUS * Math.cos(phi) + normal.x * HOP_RADIUS * Math.sin(phi),
              y: c.y - d.y * HOP_RADIUS * Math.cos(phi) + normal.y * HOP_RADIUS * Math.sin(phi),
            });
          }
        }
        out.push(b);
      }
      hops.set(line.id, out);
    });
    return hops;
  }

  /**
   * Ends that meet a node on the same side too close together for their markers, spread along
   * that side (see render). They keep the order their edges arrive in, so the lines don't
   * cross, and stay as close to where they met as the side allows. Ends with room keep their place.
   */
  private spreadEnds(edges: FloatingEdge[], nodes: DiagramNode[]): Map<string, Ports> {
    type End = { edge: string; end: 'source' | 'target'; at: Point; from: Point };
    const groups = new Map<string, { node: DiagramNode; side: 'left' | 'right' | 'top' | 'bottom'; ends: End[] }>();
    for (const edge of edges) {
      const e = this.endpoints(edge, nodes);
      if (!e?.targetNode || !e.targetPoint) continue;
      const next = edge.userVertices[0] ?? e.targetPoint;
      const previous = edge.userVertices[edge.userVertices.length - 1] ?? e.sourcePoint;
      const ends: Array<[DiagramNode, End]> = [
        [e.sourceNode, { edge: edge.id, end: 'source', at: e.sourcePoint, from: next }],
        [e.targetNode, { edge: edge.id, end: 'target', at: e.targetPoint, from: previous }],
      ];
      for (const [node, end] of ends) {
        const box = boxOf(node);
        const dx = (end.at.x - box.x) / (box.width / 2), dy = (end.at.y - box.y) / (box.height / 2);
        const side = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
        const key = `${node.id}:${side}`;
        (groups.get(key) ?? groups.set(key, { node, side, ends: [] }).get(key)!).ends.push(end);
      }
    }

    const ports = new Map<string, Ports>();
    for (const { node, side, ends } of groups.values()) {
      const vertical = side === 'left' || side === 'right';   // the side runs up and down: spread along y
      const along = (p: Point) => (vertical ? p.y : p.x);
      const met = ends.map(e => along(e.at)).sort((a, b) => a - b);
      if (met.every((v, i) => i === 0 || v - met[i - 1] >= PORT_GAP)) continue;

      const box = boxOf(node);
      const centre = vertical ? box.y : box.x;
      const half = Math.max(0, (vertical ? box.height : box.width) / 2 - PORT_INSET);
      const step = Math.min(PORT_GAP, (2 * half) / (ends.length - 1));
      const span = step * (ends.length - 1);
      const mean = met.reduce((a, b) => a + b, 0) / met.length;
      const first = Math.min(Math.max(mean - span / 2, centre - half), centre + half - span);
      const edgeLine = side === 'left' ? box.x - box.width / 2 : side === 'right' ? box.x + box.width / 2
        : side === 'top' ? box.y - box.height / 2 : box.y + box.height / 2;

      [...ends].sort((a, b) => along(a.from) - along(b.from)).forEach((end, i) => {
        const s = first + i * step;
        const toward = vertical ? { x: edgeLine, y: s } : { x: s, y: edgeLine };
        // On the side of the box, then on the node's outline in that direction (a circle's, say).
        const at = isRow(node) ? toward : boundaryPoint(node, { x: toward.x - box.x, y: toward.y - box.y });
        const port = ports.get(end.edge) ?? ports.set(end.edge, {}).get(end.edge)!;
        port[end.end] = at;
        port[end.end === 'source' ? 'sourceRoom' : 'targetRoom'] = step;
      });
    }
    return ports;
  }

  async generateEdgeGeometry(
    edge: FloatingEdge,
    nodes: DiagramNode[],
  ): Promise<Float32Array> {
    const ends = this.endpoints(edge, nodes);
    if (!ends) return new Float32Array(0);
    const { sourceNode, targetNode, sourcePoint, targetPoint } = ends;
    const allVertices = this.hops.get(edge.id) ?? [sourcePoint, ...edge.userVertices, ...(targetPoint ? [targetPoint] : [])];

    const nesting = nestingOf(nodes);
    const sourceDepth = nesting.depth(sourceNode.id);
    const depth = edgeZ(sourceDepth, targetNode ? nesting.depth(targetNode.id) : sourceDepth);
    return this.generateLineStripGeometry(allVertices, edge.style, depth);
  }
  
  private generateMarkerData(
    edge: FloatingEdge,
    nodes: DiagramNode[]
  ): Array<{
    position: [number, number],
    direction: [number, number],
    size: number,
    markerType: number,
    depth: number,
    color: [number, number, number, number]
  }> {
    const markers: Array<{
      position: [number, number],
      direction: [number, number],
      size: number,
      markerType: number,
      depth: number,
      color: [number, number, number, number]
    }> = [];
    
    const ends = this.endpoints(edge, nodes);
    if (!ends) return markers;
    const { sourceNode, targetNode, sourcePoint, targetPoint } = ends;
    const nesting = nestingOf(nodes);

    const markerSize = 7;
    const port = this.ports.get(edge.id);
    // A marker sits where the line meets the node, pointing along the line's last stretch into it.
    // On a side too crowded to space ends a marker apart (a row's end, say), markers shrink to fit.
    const add = (type: MarkerType, node: DiagramNode, at: { x: number; y: number }, from: { x: number; y: number }, room = Infinity) => {
      const dx = at.x - from.x, dy = at.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return;
      markers.push({
        position: [at.x, at.y],
        direction: [dx / length, dy / length],
        size: Math.min(markerSize, room / 2),
        markerType: this.getMarkerTypeValue(type),
        depth: markerZ(nesting.depth(node.id)),
        color: edge.style.color
      });
    };

    if (edge.style.sourceMarker && edge.style.sourceMarker !== 'none') {
      const next = edge.userVertices[0] ?? targetPoint;
      if (next) add(edge.style.sourceMarker, sourceNode, sourcePoint, next, port?.sourceRoom);
    }
    if (targetNode && targetPoint && edge.style.targetMarker && edge.style.targetMarker !== 'none') {
      const previous = edge.userVertices[edge.userVertices.length - 1] ?? sourcePoint;
      add(edge.style.targetMarker, targetNode, targetPoint, previous, port?.targetRoom);
    }

    return markers;
  }
  
  async render(
    renderPass: GPURenderPassEncoder, 
    edges: FloatingEdge[], 
    nodes: DiagramNode[],
    viewProjectionMatrix: number[] | Float32Array,
    previewEdge?: EdgeDrawingState,
    selectedEdges?: DiagramEdge[],  
    viewport?: {zoom: number}        
  ) {
    // Update uniforms
    const matrixData = new Float32Array(viewProjectionMatrix);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, matrixData);
    
    let bufferOffset = 0;
    let totalVertices = 0;
    const allMarkers: Array<any> = [];

    // Edge ends that would crowd one spot on a node's side get their own places on it, so markers
    // (an arrow and a diamond, say) don't overlap. Worked out once per frame, from the plain ends.
    this.ports = new Map();
    this.ports = this.spreadEnds(edges, nodes);
    // Then crossings: the lines that hop over others, drawn with their arcs.
    this.hops = new Map();
    this.hops = this.findHops(edges, nodes);
    
    // Render regular edges
    for (const edge of edges) {
      let geometry = await this.generateEdgeGeometry(
        edge, 
        nodes,
      );
      
      if (edge.id === selectedEdges?.[0]?.id) {
        geometry = await this.generateEdgeGeometry(
          {...edge, style: { ...edge.style, thickness: edge.style.thickness + 2, color: [1.0, 0.5, 0.0, 1.0] }},
          nodes,
        );
      }
      
      if (geometry.length === 0) continue;
      
      this.device.queue.writeBuffer(
        this.edgeBuffer, 
        bufferOffset, 
        geometry.buffer,
        0,
        geometry.byteLength
      );
      
      const vertexCount = geometry.length / 8;
      bufferOffset += geometry.byteLength;
      totalVertices += vertexCount;
      
      // Generate marker data for this edge
      const markerData = this.generateMarkerData(edge, nodes);
      allMarkers.push(...markerData);
    }

    // Render preview edge if it exists
    if (previewEdge && previewEdge.isDrawing && previewEdge.userVertices.length > 0) {
      const tempEdge: FloatingEdge = {
        id: 'preview-edge',
        sourceNodeId: previewEdge.sourceNodeId as string,
        targetNodeId: '',
        userVertices: [...previewEdge.userVertices],
        style: previewEdge.style || { 
          color: [0.5, 0.7, 1.0, 0.8],
          thickness: 2 
        }
      };
      
      const geometry = await this.generateEdgeGeometry(
        tempEdge,
        nodes,
      );
      
      if (geometry.length > 0) {
        this.device.queue.writeBuffer(
          this.edgeBuffer,
          bufferOffset,
          geometry.buffer,
          0,
          geometry.byteLength
        );
        
        const vertexCount = geometry.length / 8;
        totalVertices += vertexCount;
      }
    }
    
    // Draw all edges
    if (totalVertices > 0) {
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.edgeBuffer);
      renderPass.draw(totalVertices);
    }
    
    // Draw markers
    if (allMarkers.length > 0) {
    const flatMarkerData = new Float32Array(allMarkers.length * 16); // 16 floats per marker, matching the WGSL struct
      allMarkers.forEach((marker, i) => {
        const offset = i * 16;
        flatMarkerData[offset + 0] = marker.position[0];
        flatMarkerData[offset + 1] = marker.position[1];
        flatMarkerData[offset + 2] = marker.direction[0];
        flatMarkerData[offset + 3] = marker.direction[1];
        flatMarkerData[offset + 4] = marker.size;
        flatMarkerData[offset + 5] = marker.markerType;
        flatMarkerData[offset + 6] = marker.depth;
        flatMarkerData[offset + 7] = 0; // padding1
        flatMarkerData[offset + 8] = marker.color[0];
        flatMarkerData[offset + 9] = marker.color[1];
        flatMarkerData[offset + 10] = marker.color[2];
        flatMarkerData[offset + 11] = marker.color[3];
        flatMarkerData[offset + 12] = 0; // padding2
        flatMarkerData[offset + 13] = 0; // padding2
        flatMarkerData[offset + 14] = 0; // padding3
        flatMarkerData[offset + 15] = 0; // padding3
      });
      this.device.queue.writeBuffer(this.markerBuffer, 0, flatMarkerData);
      
      renderPass.setPipeline(this.markerPipeline);
      renderPass.setBindGroup(0, this.markerBindGroup);
    renderPass.draw(6, allMarkers.length);
    }
    
    // Draw vertex handles for selected edges
    if (selectedEdges && selectedEdges.length > 0 && viewport) {
      const handleData = this.generateVertexHandles(selectedEdges[0], viewport.zoom);
      
      if (handleData.length > 0) {
        const flatHandleData = new Float32Array(handleData.length * 8);
        handleData.forEach((handle, i) => {
          const offset = i * 8;
          flatHandleData[offset + 0] = handle.position[0];
          flatHandleData[offset + 1] = handle.position[1];
          flatHandleData[offset + 2] = handle.size[0];
          flatHandleData[offset + 3] = handle.size[1];
          flatHandleData[offset + 4] = handle.color[0];
          flatHandleData[offset + 5] = handle.color[1];
          flatHandleData[offset + 6] = handle.color[2];
          flatHandleData[offset + 7] = handle.color[3];
        });
        
        this.device.queue.writeBuffer(this.vertexHandleBuffer, 0, flatHandleData);
        
        renderPass.setPipeline(this.handleRenderPipeline);
        renderPass.setBindGroup(0, this.handleBindGroup);
        renderPass.draw(6, handleData.length);
      }
    }
  }
  
  private generateVertexHandles(
    edge: DiagramEdge, 
    zoom: number
  ): Array<{position: [number, number], size: [number, number], color: [number, number, number, number]}> {
    const handleSize = Math.max(16 / zoom, 10);
    const handles: Array<{position: [number, number], size: [number, number], color: [number, number, number, number]}> = [];
    
    for (const vertex of edge.userVertices) {
      handles.push({
        position: [vertex.x, vertex.y],
        size: [handleSize, handleSize],
        color: [0.3, 0.8, 1.0, 1.0],
      });
    }
    
    return handles;
  }
  
  destroy() {
    if (this.edgeBuffer) {
      this.edgeBuffer.destroy();
    }
    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
    }
    if (this.vertexHandleBuffer) {
      this.vertexHandleBuffer.destroy();
    }
    if (this.markerBuffer) {
      this.markerBuffer.destroy();
    }
  }
}