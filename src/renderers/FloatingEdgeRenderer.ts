// Enhanced FloatingEdgeRenderer with comprehensive marker support
import type { EdgeDrawingState } from '../components/DiagramProvider';
import type { VisualContentNodeManager } from '../compute/VisualContentNode';
import type { DiagramEdge, DiagramNode } from '../types';
import { Z_LAYERS } from '../utils/DepthConstants';

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

class EdgeConnectionCalculator {
  calculateNodeEdgePoint(
    nodePosition: {x: number, y: number},
    nodeSize: {width: number, height: number},
    nodeShape: string,
    directionToTarget: {x: number, y: number}
  ): {x: number, y: number} {
    
    const length = Math.sqrt(directionToTarget.x ** 2 + directionToTarget.y ** 2);
    if (length === 0) return nodePosition;
    
    const normalizedDir = {
      x: directionToTarget.x / length,
      y: directionToTarget.y / length
    };
    
    switch (nodeShape) {
      case 'rectangle':
      case 'roundedRectangle':
        return this.rectangleEdgeIntersection(nodePosition, nodeSize, normalizedDir);
      case 'circle':
        return this.circleEdgeIntersection(nodePosition, nodeSize, normalizedDir);
      case 'oval':
        return this.ellipseEdgeIntersection(nodePosition, nodeSize, normalizedDir);
      case 'hexagon':
        return this.hexagonEdgeIntersection(nodePosition, nodeSize, normalizedDir);
      case 'diamond':
        return this.diamondEdgeIntersection(nodePosition, nodeSize, normalizedDir);
      default:
        return this.rectangleEdgeIntersection(nodePosition, nodeSize, normalizedDir);
    }
  }
  
  private rectangleEdgeIntersection(
    center: {x: number, y: number},
    size: {width: number, height: number},
    direction: {x: number, y: number}
  ): {x: number, y: number} {
    const halfWidth = size.width / 2;
    const halfHeight = size.height / 2;
    
    const tx = direction.x === 0 ? Infinity : (direction.x > 0 ? halfWidth : -halfWidth) / direction.x;
    const ty = direction.y === 0 ? Infinity : (direction.y > 0 ? halfHeight : -halfHeight) / direction.y;
    
    const t = Math.min(Math.abs(tx), Math.abs(ty));
    
    return {
      x: center.x + direction.x * t,
      y: center.y + direction.y * t
    };
  }
  
  private circleEdgeIntersection(
    center: {x: number, y: number},
    size: {width: number, height: number},
    direction: {x: number, y: number}
  ): {x: number, y: number} {
    const radius = Math.min(size.width, size.height) / 2;
    
    return {
      x: center.x + direction.x * radius,
      y: center.y + direction.y * radius
    };
  }
  
  private ellipseEdgeIntersection(
    center: {x: number, y: number},
    size: {width: number, height: number},
    direction: {x: number, y: number}
  ): {x: number, y: number} {
    const a = size.width / 2;
    const b = size.height / 2;
    
    const denominator = (direction.x / a) ** 2 + (direction.y / b) ** 2;
    const t = 1 / Math.sqrt(denominator);
    
    return {
      x: center.x + direction.x * t,
      y: center.y + direction.y * t
    };
  }
  
  private hexagonEdgeIntersection(
    center: {x: number, y: number},
    size: {width: number, height: number},
    direction: {x: number, y: number}
  ): {x: number, y: number} {
    return this.circleEdgeIntersection(center, size, direction);
  }
  
  private diamondEdgeIntersection(
    center: {x: number, y: number},
    size: {width: number, height: number},
    direction: {x: number, y: number}
  ): {x: number, y: number} {
    const halfWidth = size.width / 2;
    const halfHeight = size.height / 2;
    
    const absX = Math.abs(direction.x);
    const absY = Math.abs(direction.y);
    const t = 1 / (absX / halfWidth + absY / halfHeight);
    
    return {
      x: center.x + direction.x * t,
      y: center.y + direction.y * t
    };
  }
}

export class FloatingEdgeRenderer {
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
  private connectionCalculator: EdgeConnectionCalculator;
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
    this.connectionCalculator = new EdgeConnectionCalculator();
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
    
    // Buffer for markers (more instances needed)
    this.markerBuffer = this.device.createBuffer({
      size: this.maxEdges * 2 * 64, // 2 markers per edge, 12 floats each
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
          @location(2) uv: vec2<f32>,
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
          output.position = uniforms.viewProjection * vec4<f32>(input.position, ${Z_LAYERS.EDGES}, 1.0);
          output.color = input.color;
          output.uv = input.uv;
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
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
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
              srcFactor: 'src-alpha',        // CHANGED back
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
    const markerDepth = Math.max(Z_LAYERS.NODES, Z_LAYERS.EDGES) + 0.1;

    const markerShaderCode = `
      struct Uniforms {
        viewProjection: mat4x4<f32>,
      }
      
      struct MarkerData {
        position: vec2<f32>,      // offset 0-8
        direction: vec2<f32>,     // offset 8-16
        size: f32,                // offset 16-20
        markerType: f32,          // offset 20-24
        padding1: vec2<f32>,      // offset 24-32 (padding to align next vec4)
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
        
        //Rotate to align with direction
        let angle = atan2(marker.direction.y, marker.direction.x);
        let cosA = cos(angle);
        let sinA = sin(angle);
        let rotated = vec2<f32>(
          localPos.x * cosA - localPos.y * sinA,
          localPos.x * sinA + localPos.y * cosA
        );
        
        let worldPos = marker.position + rotated * marker.size;
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${markerDepth}, 1.0);
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
              srcFactor: 'one',           // CHANGED
              dstFactor: 'one-minus-src-alpha',
            },
            alpha: {
              srcFactor: 'one',           // CHANGED
              dstFactor: 'one-minus-src-alpha',
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',  // ADDED - don't cull any faces
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
  
  private generateLineStripGeometry(
    vertices: Array<{x: number, y: number}>, 
    style: EdgeStyle
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
        p1.x + nx, p1.y + ny, ...color, 0, 0,
        p1.x - nx, p1.y - ny, ...color, 0, 1,
        p2.x + nx, p2.y + ny, ...color, 1, 0,
        
        p1.x - nx, p1.y - ny, ...color, 0, 1,
        p2.x - nx, p2.y - ny, ...color, 1, 1,
        p2.x + nx, p2.y + ny, ...color, 1, 0,
      ];
      
      geometry.push(...segmentVerts);
    }
    
    return new Float32Array(geometry);
  }

  async generateEdgeGeometry(
    edge: FloatingEdge, 
    nodes: DiagramNode[],
    visualContentNodeManager?: VisualContentNodeManager,
  ): Promise<Float32Array> {
    const sourceNode = nodes.find((node) => node.id === edge.sourceNodeId);
    
    if (!sourceNode) {  
      return new Float32Array(0);
    }

    const targetNode = nodes.find((node) => node.id === edge.targetNodeId);
    
    const allVertices: Array<{x: number, y: number}> = [];

    let firstDirection: {x: number, y: number};
    
    if (edge.userVertices.length > 0) {
      firstDirection = {
        x: edge.userVertices[0].x - sourceNode.data.position.x,
        y: edge.userVertices[0].y - sourceNode.data.position.y
      };
    } else if (targetNode) {
      firstDirection = {
        x: targetNode.data.position.x - sourceNode.data.position.x,
        y: targetNode.data.position.y - sourceNode.data.position.y
      };
    } else {
      return new Float32Array(0);
    }
    
    let sourcePoint: {x: number, y: number};
    
    if (visualContentNodeManager) {
      const sourceVisualNode = visualContentNodeManager.getVisualNode(edge.sourceNodeId);
      
      if (sourceVisualNode && sourceNode.visual!.shape === 'none' && sourceNode.visual!.visualContent) {
        sourcePoint = await sourceVisualNode.getEdgePoint(firstDirection);
      } else {
        sourcePoint = this.connectionCalculator.calculateNodeEdgePoint(
          sourceNode.data.position,
          sourceNode.visual!.size,
          sourceNode.visual!.shape as string,
          firstDirection
        );
      }
    } else {
      sourcePoint = this.connectionCalculator.calculateNodeEdgePoint(
        sourceNode.data.position,
        sourceNode.visual!.size,
        sourceNode.visual!.shape as string,
        firstDirection
      );
    }
    
    allVertices.push(sourcePoint);
    allVertices.push(...edge.userVertices);
    
    if (targetNode) {
      const lastDirection = edge.userVertices.length > 0
        ? {
            x: targetNode.data.position.x - edge.userVertices[edge.userVertices.length - 1].x,
            y: targetNode.data.position.y - edge.userVertices[edge.userVertices.length - 1].y
          }
        : {
            x: targetNode.data.position.x - sourceNode.data.position.x,
            y: targetNode.data.position.y - sourceNode.data.position.y
          };
      
      let targetPoint: {x: number, y: number};
      
      if (visualContentNodeManager) {
        const targetVisualNode = visualContentNodeManager.getVisualNode(edge.targetNodeId);
        
        if (targetVisualNode && targetNode.visual!.shape === 'none' && targetNode.visual!.visualContent) {
          targetPoint = await targetVisualNode.getEdgePoint({
            x: -lastDirection.x, 
            y: -lastDirection.y
          });
        } else {
          targetPoint = this.connectionCalculator.calculateNodeEdgePoint(
            targetNode.data.position,
            targetNode.visual!.size,
            targetNode.visual!.shape as string,
            {x: -lastDirection.x, y: -lastDirection.y}
          );
        }
      } else {
        targetPoint = this.connectionCalculator.calculateNodeEdgePoint(
          targetNode.data.position,
          targetNode.visual!.size,
          targetNode.visual!.shape as string,
          {x: -lastDirection.x, y: -lastDirection.y}
        );
      }
      
      allVertices.push(targetPoint);
    }
    
    return this.generateLineStripGeometry(allVertices, edge.style);
  }
  
  private generateMarkerData(
    edge: FloatingEdge,
    nodes: DiagramNode[]
  ): Array<{
    position: [number, number],
    direction: [number, number],
    size: number,
    markerType: number,
    color: [number, number, number, number]
  }> {
    const markers: Array<{
      position: [number, number],
      direction: [number, number],
      size: number,
      markerType: number,
      color: [number, number, number, number]
    }> = [];
    
    const sourceNode = nodes.find(n => n.id === edge.sourceNodeId);
    const targetNode = nodes.find(n => n.id === edge.targetNodeId);
    
    const markerSize = 7;
    
    // Source marker
    if (edge.style.sourceMarker && edge.style.sourceMarker !== 'none') {
      const firstVertex = edge.userVertices.length > 0 
        ? edge.userVertices[0] 
        : targetNode?.data.position;
      
      const direction = {
        x: sourceNode!.data.position.x - firstVertex!.x,
        y: sourceNode!.data.position.y - firstVertex!.y
      };
      
      const length = Math.sqrt(direction.x ** 2 + direction.y ** 2);
      if (length > 0) {
        const normalized = {
          x: direction.x / length,
          y: direction.y / length
        };
        
        // Source marker points AWAY from the node
        const sourceEdge = this.connectionCalculator.calculateNodeEdgePoint(
          sourceNode!.data.position,
          sourceNode!.visual!.size,
          sourceNode!.visual!.shape as string,
          { x: -normalized.x, y: -normalized.y } // Point outward from source
        );
        
        
        markers.push({
          position: [sourceEdge.x, sourceEdge.y],
          direction: [normalized.x, normalized.y], // Direction AWAY from source
          size: markerSize,
          markerType: this.getMarkerTypeValue(edge.style.sourceMarker),
          color: edge.style.color
        });
      }
    }
    
    // Target marker
    if (edge.style.targetMarker && edge.style.targetMarker !== 'none') {
      const lastVertex = edge.userVertices.length > 0
        ? edge.userVertices[edge.userVertices.length - 1]
        : sourceNode!.data.position;
      
      const direction = {
        x: targetNode!.data.position.x - lastVertex.x,
        y: targetNode!.data.position.y - lastVertex.y
      };
      
      const length = Math.sqrt(direction.x ** 2 + direction.y ** 2);
      if (length > 0) {
        const normalized = {
          x: direction.x / length,
          y: direction.y / length
        };
        
        const targetEdge = this.connectionCalculator.calculateNodeEdgePoint(
          targetNode!.data.position,
          targetNode!.visual!.size,
          targetNode!.visual!.shape as string,
          { x: -normalized.x, y: -normalized.y } 
        );
        
        markers.push({
          position: [targetEdge.x, targetEdge.y],
          direction: [normalized.x, normalized.y],
          size: markerSize,
          markerType: this.getMarkerTypeValue(edge.style.targetMarker),
          color: edge.style.color
        });
      }
    }
    
    console.log('Generated markers:', markers);
    
    return markers;
  }
  
  async render(
    renderPass: GPURenderPassEncoder, 
    edges: FloatingEdge[], 
    nodes: DiagramNode[],
    viewProjectionMatrix: number[] | Float32Array,
    visualContentNodeManager?: VisualContentNodeManager,
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
    
    // Render regular edges
    for (const edge of edges) {
      let geometry = await this.generateEdgeGeometry(
        edge, 
        nodes, 
        visualContentNodeManager,
      );
      
      if (edge.id === selectedEdges?.[0]?.id) {
        geometry = await this.generateEdgeGeometry(
          {...edge, style: { ...edge.style, thickness: edge.style.thickness + 2, color: [1.0, 0.5, 0.0, 1.0] }},
          nodes, 
          visualContentNodeManager,
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
        visualContentNodeManager,
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
    const flatMarkerData = new Float32Array(allMarkers.length * 14); // Changed from 12 to 14!
      allMarkers.forEach((marker, i) => {
        const offset = i * 16; // Changed from 12 to 14
        flatMarkerData[offset + 0] = marker.position[0];
        flatMarkerData[offset + 1] = marker.position[1];
        flatMarkerData[offset + 2] = marker.direction[0];
        flatMarkerData[offset + 3] = marker.direction[1];
        flatMarkerData[offset + 4] = marker.size;
        flatMarkerData[offset + 5] = marker.markerType;
        flatMarkerData[offset + 6] = 0; // padding1
        flatMarkerData[offset + 7] = 0; // padding1
        flatMarkerData[offset + 8] = marker.color[0];   // color now at offset 8
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
      console.log('About to draw:', {
      vertices: 6,
      instanceCount: allMarkers.length,
      bufferLength: flatMarkerData.length,
      expectedLength: allMarkers.length * 14
    });
    renderPass.draw(6, allMarkers.length);
      console.log('Rendered markers count:', allMarkers.length);
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