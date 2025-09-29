import type { DiagramNode, Viewport } from '../types';

export interface FloatingEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  userVertices: Array<{x: number, y: number}>; // User-defined intermediate points
  style: {
    color: [number, number, number, number];
    thickness: number;
    dashPattern?: number[]; // Optional dashing
  };
}

class ShaderBasedEdgeDetector {
  private device: GPUDevice;
  private computePipeline!: GPUComputePipeline;
  private edgeBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private bindGroupLayout!: GPUBindGroupLayout;
  private sampler!: GPUSampler;
  
  constructor(device: GPUDevice) {
    this.device = device;
    this.createBuffers();
    this.createSampler();
    this.createPipeline();
  }
  
  private createBuffers() {
    this.edgeBuffer = this.device.createBuffer({
      size: 8, // 2 floats (x, y)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      label: 'edge-detection-output'
    });
    
    this.uniformBuffer = this.device.createBuffer({
      size: 32, // 8 floats for parameters
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'edge-detection-uniforms'
    });
  }
  
  private createSampler() {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
  }
  
  private createPipeline() {
    const computeShader = this.device.createShaderModule({
      code: `
        @group(0) @binding(0) var inputTexture: texture_2d<f32>;
        @group(0) @binding(1) var textureSampler: sampler;
        @group(0) @binding(2) var<storage, read_write> edgePoints: array<vec2<f32>>;
        @group(0) @binding(3) var<uniform> params: EdgeDetectionParams;
        
        struct EdgeDetectionParams {
          nodeCenter: vec2<f32>,
          targetDirection: vec2<f32>,
          maxDistance: f32,
          stepSize: f32,
        }
        
        @compute @workgroup_size(1)
        fn main() {
          let rayDir = normalize(params.targetDirection);
          
          for (var distance = 0.0; distance < params.maxDistance; distance += params.stepSize) {
            let samplePos = params.nodeCenter + rayDir * distance;
            let uv = (samplePos + vec2<f32>(0.5)) / vec2<f32>(1.0);
            
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
              edgePoints[0] = samplePos;
              return;
            }
            
            let alpha = textureSample(inputTexture, textureSampler, uv).a;
            if (alpha < 0.5) {
              edgePoints[0] = samplePos;
              return;
            }
          }
          
          edgePoints[0] = params.nodeCenter + rayDir * params.maxDistance;
        }
      `
    });
    
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
      ]
    });
    
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      compute: {
        module: computeShader,
        entryPoint: 'main'
      }
    });
  }
  
  async detectEdgePoint(
    nodeTexture: GPUTexture,
    nodeCenter: {x: number, y: number},
    targetDirection: {x: number, y: number},
    maxDistance: number = 100
  ): Promise<{x: number, y: number}> {
    
    const uniformData = new Float32Array([
      nodeCenter.x, nodeCenter.y,
      targetDirection.x, targetDirection.y,
      maxDistance,
      1.0 // stepSize
    ]);
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: nodeTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.edgeBuffer } },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ]
    });
    
    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(1);
    
    computePass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Read back result
    const readBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    
    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(this.edgeBuffer, 0, readBuffer, 0, 8);
    this.device.queue.submit([copyEncoder.finish()]);
    
    await readBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(readBuffer.getMappedRange());
    const result = { x: resultData[0], y: resultData[1] };
    readBuffer.unmap();
    readBuffer.destroy();
    
    return result;
  }
  
  destroy() {
    this.edgeBuffer.destroy();
    this.uniformBuffer.destroy();
  }
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
    // Simplified hexagon as circle for now
    return this.circleEdgeIntersection(center, size, direction);
  }
  
  private diamondEdgeIntersection(
    center: {x: number, y: number},
    size: {width: number, height: number},
    direction: {x: number, y: number}
  ): {x: number, y: number} {
    const halfWidth = size.width / 2;
    const halfHeight = size.height / 2;
    
    // Diamond intersection (45° rotated square)
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
  private device: GPUDevice;
  private edgeBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private renderPipeline!: GPURenderPipeline;
  private bindGroup!: GPUBindGroup;
  private maxVerticesPerEdge: number;
  private maxEdges: number;
  private edgeDetector: ShaderBasedEdgeDetector;
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
    this.edgeDetector = new ShaderBasedEdgeDetector(device);
    this.connectionCalculator = new EdgeConnectionCalculator();
    
    this.createBuffers();
    this.createPipeline(format);
    this.createBindGroup();
  }
  
  private createBuffers() {
    // Vertex format: position(2) + color(4) + uv(2) = 8 floats per vertex
    const verticesPerSegment = 6; // Two triangles per line segment
    const bufferSize = this.maxEdges * this.maxVerticesPerEdge * verticesPerSegment * 8 * 4;
    
    this.edgeBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'floating-edge-buffer'
    });
    
    this.uniformBuffer = this.device.createBuffer({
      size: 64, // 4x4 matrix
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
          output.position = uniforms.viewProjection * vec4<f32>(input.position, 10.0, 1.0);
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
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 32, // 8 floats * 4 bytes
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // position
            { shaderLocation: 1, offset: 8, format: 'float32x4' },  // color
            { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
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
      
      // Calculate perpendicular vector for line thickness
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      const nx = -dy / length * thickness * 0.5;
      const ny = dx / length * thickness * 0.5;
      
      // Create quad for this line segment (2 triangles = 6 vertices)
      const segmentVerts = [
        // Triangle 1
        p1.x + nx, p1.y + ny, ...color, 0, 0, // Top-left
        p1.x - nx, p1.y - ny, ...color, 0, 1, // Bottom-left  
        p2.x + nx, p2.y + ny, ...color, 1, 0, // Top-right
        
        // Triangle 2
        p1.x - nx, p1.y - ny, ...color, 0, 1, // Bottom-left
        p2.x - nx, p2.y - ny, ...color, 1, 1, // Bottom-right
        p2.x + nx, p2.y + ny, ...color, 1, 0, // Top-right
      ];
      
      geometry.push(...segmentVerts);
    }
    
    return new Float32Array(geometry);
  }
  
  async generateEdgeGeometry(
    edge: FloatingEdge, 
    nodes: Map<string, DiagramNode>
  ): Promise<Float32Array> {
    const sourceNode = nodes.get(edge.sourceNodeId);
    const targetNode = nodes.get(edge.targetNodeId);
    
    if (!sourceNode || !targetNode) return new Float32Array(0);
    
    const allVertices: Array<{x: number, y: number}> = [];
    
    // Calculate source connection point
    const firstDirection = edge.userVertices.length > 0 
      ? {
          x: edge.userVertices[0].x - sourceNode.data.position.x,
          y: edge.userVertices[0].y - sourceNode.data.position.y
        }
      : {
          x: targetNode.data.position.x - sourceNode.data.position.x,
          y: targetNode.data.position.y - sourceNode.data.position.y
        };
    
    let sourcePoint: {x: number, y: number};
    
    if (sourceNode.visual?.shape === 'none' && sourceNode.visual.visualContent) {
      // Use shader-based edge detection for arbitrary shapes
      // Note: This would require the node's rendered texture
      // For now, fall back to geometric calculation
      sourcePoint = this.connectionCalculator.calculateNodeEdgePoint(
        sourceNode.data.position,
        sourceNode.visual.size,
        'circle', // Fallback shape
        firstDirection
      );
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
    
    // Calculate target connection point
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
    
    if (targetNode.visual?.shape === 'none' && targetNode.visual?.visualContent) {
      // Use shader-based edge detection for arbitrary shapes
      targetPoint = this.connectionCalculator.calculateNodeEdgePoint(
        targetNode.data.position,
        targetNode.visual!.size,
        'circle', // Fallback shape
        {x: -lastDirection.x, y: -lastDirection.y}
      );
    } else {
      targetPoint = this.connectionCalculator.calculateNodeEdgePoint(
        targetNode.data.position,
        targetNode.visual!.size,
        targetNode.visual!.shape as string,
        {x: -lastDirection.x, y: -lastDirection.y}
      );
    }
    
    allVertices.push(targetPoint);
    
    return this.generateLineStripGeometry(allVertices, edge.style);
  }
  
  async render(
    renderPass: GPURenderPassEncoder, 
    edges: FloatingEdge[], 
    nodes: Map<string, DiagramNode>,
    viewProjectionMatrix: number[] | Float32Array
  ) {
    if (edges.length === 0) return;
    
    // Update uniforms
    const matrixData = new Float32Array(viewProjectionMatrix);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, matrixData);
    
    let bufferOffset = 0;
    let totalVertices = 0;
    
    for (const edge of edges) {
      const geometry = await this.generateEdgeGeometry(edge, nodes);
      if (geometry.length === 0) continue;
      
      // Write geometry to buffer at current offset
      this.device.queue.writeBuffer(
        this.edgeBuffer, 
        bufferOffset, 
        geometry.buffer,
        0,
        geometry.byteLength
      );
      
      const vertexCount = geometry.length / 8; // 8 floats per vertex
      bufferOffset += geometry.byteLength;
      totalVertices += vertexCount;
    }
    
    if (totalVertices > 0) {
      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.edgeBuffer);
      renderPass.draw(totalVertices);
    }
  }
  
  // Method to use shader-based edge detection for 'none' shape nodes
  async calculateShaderBasedEdgePoint(
    nodeTexture: GPUTexture,
    nodeCenter: {x: number, y: number},
    targetDirection: {x: number, y: number},
    maxDistance: number = 100
  ): Promise<{x: number, y: number}> {
    return await this.edgeDetector.detectEdgePoint(
      nodeTexture,
      nodeCenter,
      targetDirection,
      maxDistance
    );
  }
  
  destroy() {
    this.edgeBuffer.destroy();
    this.uniformBuffer.destroy();
    this.edgeDetector.destroy();
  }
}