import type { EdgeDrawingState } from '../components/DiagramProvider';
import type { VisualContentNodeManager } from '../compute/VisualContentNode';
import type { DiagramNode } from '../types';
import { Z_LAYERS } from '../utils/DepthConstants';

export interface FloatingEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  userVertices: Array<{x: number, y: number}>;
  style: {
    color: [number, number, number, number];
    thickness: number;
    dashPattern?: number[];
  };
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
  private uniformBuffer!: GPUBuffer;
  private renderPipeline!: GPURenderPipeline;
  private bindGroup!: GPUBindGroup;
  private maxVerticesPerEdge: number;
  private maxEdges: number;
  private connectionCalculator: EdgeConnectionCalculator;
  
  constructor(
    device: GPUDevice, 
    format: GPUTextureFormat = 'bgra8unorm',
    maxVerticesPerEdge = 20, 
    maxEdges = 1000
  ) {
    this.device = device;
    this.maxVerticesPerEdge = maxVerticesPerEdge;
    this.maxEdges = maxEdges;
    this.connectionCalculator = new EdgeConnectionCalculator();
    
    this.createBuffers();
    this.createPipeline(format);
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
    
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'edge-uniforms'
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
      }
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
  }
  
  private generateLineStripGeometry(
    vertices: Array<{x: number, y: number}>, 
    style: FloatingEdge['style']
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
    const targetNode = nodes.find((node) => node.id === edge.targetNodeId);
    let altPosition = {x: 0, y: 0};
    
    if (!sourceNode) return new Float32Array(0);

    if (!targetNode)
      console.log('================================================================================================================================no target node for edge which means this must be the previewEdge: ', edge);
      const temp = edge.userVertices.pop();
      altPosition = temp ? {x: temp.x, y: temp.y} : {x: sourceNode.data.position.x + 100, y: sourceNode.data.position.y + 100};
    
  
    const allVertices: Array<{x: number, y: number}> = [];

    let firstDirection = {x: 0, y: 0};
    if (targetNode) {
   firstDirection = edge.userVertices.length > 0 
      ? {
          x: edge.userVertices[0].x - sourceNode.data.position.x,
          y: edge.userVertices[0].y - sourceNode.data.position.y
        }
      : {
          x: targetNode.data.position.x - sourceNode.data.position.x,
          y: targetNode.data.position.y - sourceNode.data.position.y
        };
      }
      else {
        firstDirection = edge.userVertices.length > 0
        ? {
            x: edge.userVertices[0].x - sourceNode.data.position.x,
            y: edge.userVertices[0].y - sourceNode.data.position.y
          }
        : {
            x: altPosition.x - sourceNode.data.position.x,
            y: altPosition.y - sourceNode.data.position.y
          };
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
    let lastDirection = {x: 0, y: 0};
    if (targetNode) {
    lastDirection = edge.userVertices.length > 0
      ? {
          x: targetNode.data.position.x - edge.userVertices[edge.userVertices.length - 1].x,
          y: targetNode.data.position.y - edge.userVertices[edge.userVertices.length - 1].y
        }
      : {
          x: targetNode.data.position.x - sourceNode.data.position.x,
          y: targetNode.data.position.y - sourceNode.data.position.y
        };
      }
      else {
        lastDirection = edge.userVertices.length > 0
        ? {
            x: altPosition.x - edge.userVertices[edge.userVertices.length - 1].x,
            y: altPosition.y - edge.userVertices[edge.userVertices.length - 1].y
          }
        : {
            x: altPosition.x - sourceNode.data.position.x,
            y: altPosition.y - sourceNode.data.position.y
          };
      }
    
    let targetPoint: {x: number, y: number} = {x: 0, y: 0};
    
    if (visualContentNodeManager) {
      const targetVisualNode = visualContentNodeManager.getVisualNode(edge.targetNodeId);
      
      if (targetVisualNode && targetNode && targetNode.visual!.shape === 'none' && targetNode.visual!.visualContent) {
        targetPoint = await targetVisualNode.getEdgePoint({
          x: -lastDirection.x, 
          y: -lastDirection.y
        });
      } else {
        if (targetNode) {
        targetPoint = this.connectionCalculator.calculateNodeEdgePoint(
          targetNode.data.position,
          targetNode.visual!.size,
          targetNode.visual!.shape as string,
          {x: -lastDirection.x, y: -lastDirection.y}
        );
        }
      }
    } else {
      if (targetNode) {
      targetPoint = this.connectionCalculator.calculateNodeEdgePoint(
        targetNode.data.position,
        targetNode.visual!.size,
        targetNode.visual!.shape as string,
        {x: -lastDirection.x, y: -lastDirection.y}
      );
      }
    }
    
    allVertices.push(targetPoint);
    
    return this.generateLineStripGeometry(allVertices, edge.style);
  }
  
  async render(
    renderPass: GPURenderPassEncoder, 
    edges: FloatingEdge[], 
    nodes: DiagramNode[],
    viewProjectionMatrix: number[] | Float32Array,
    visualContentNodeManager?: VisualContentNodeManager,
    previewEdge?: EdgeDrawingState
  ) {
    if (edges.length === 0) return;

    if (previewEdge) {
      const tempEdge = {...previewEdge, id: 'preview-edge', sourceNodeId: previewEdge.sourceNodeId as string, targetNodeId: '', userVertices: previewEdge.userVertices as Array<{x: number, y: number}>, style: previewEdge.style as { color: [number, number, number, number]; thickness: number; dashPattern?: number[]}  };
      console.log('rendering with preview edge: ', tempEdge);
      edges = [...edges, tempEdge];
    }
    
    const matrixData = new Float32Array(viewProjectionMatrix);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, matrixData);
    
    let bufferOffset = 0;
    let totalVertices = 0;
    
    for (const edge of edges) {
      const geometry = await this.generateEdgeGeometry(edge, nodes, visualContentNodeManager);
      console.log('i am edging');
      if (geometry.length === 0) continue;

      if (geometry.length > 0) {
        console.log('geometry big.')
      }

      
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
    }

    
    if (totalVertices > 0) {
      console.log('hi i am total vertice big...')
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.edgeBuffer);
      renderPass.draw(totalVertices);
    }
  }
  
  destroy() {
    this.edgeBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}