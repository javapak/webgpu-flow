export class ShaderBasedEdgeDetector {
  private device!: GPUDevice;
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
  
  getDevice(): GPUDevice {
    return this.device;
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
          
          // Start from edge of node center, not center itself
          var currentDistance = 0.0;
          
          for (var step = 0u; step < 200u; step++) {
            currentDistance += params.stepSize;
            if (currentDistance >= params.maxDistance) {
              break;
            }
            
            let samplePos = params.nodeCenter + rayDir * currentDistance;
            
            // Convert world position to texture UV coordinates
            // This assumes the texture represents the node's visual content
            // You may need to adjust this based on your texture coordinate system
            let uv = vec2<f32>(
              (samplePos.x - params.nodeCenter.x) / params.maxDistance + 0.5,
              (samplePos.y - params.nodeCenter.y) / params.maxDistance + 0.5
            );
            
            // Check if we're outside the texture bounds
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
              edgePoints[0] = samplePos;
              return;
            }
            
            // Sample the alpha channel to detect transparency (edge of content)
            let alpha = textureSample(inputTexture, textureSampler, uv).a;
            
            // If we hit transparent area, we found the edge
            if (alpha < 0.5) {
              edgePoints[0] = samplePos;
              return;
            }
          }
          
          // If we didn't find an edge, return the maximum distance point
          edgePoints[0] = params.nodeCenter + rayDir * params.maxDistance;
        }
      `,
      label: 'edge-detection-compute-shader'
    });
    
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { 
          binding: 0, 
          visibility: GPUShaderStage.COMPUTE, 
          texture: { sampleType: 'float' } 
        },
        { 
          binding: 1, 
          visibility: GPUShaderStage.COMPUTE, 
          sampler: {} 
        },
        { 
          binding: 2, 
          visibility: GPUShaderStage.COMPUTE, 
          buffer: { type: 'storage' } 
        },
        { 
          binding: 3, 
          visibility: GPUShaderStage.COMPUTE, 
          buffer: { type: 'uniform' } 
        }
      ],
      label: 'edge-detection-bind-group-layout'
    });
    
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      compute: {
        module: computeShader,
        entryPoint: 'main'
      },
      label: 'edge-detection-compute-pipeline'
    });
  }
  
  async detectEdgePoint(
    nodeTexture: GPUTexture,
    nodeCenter: {x: number, y: number},
    targetDirection: {x: number, y: number},
    maxDistance: number = 100
  ): Promise<{x: number, y: number}> {
    
    // Normalize direction vector
    const length = Math.sqrt(targetDirection.x ** 2 + targetDirection.y ** 2);
    if (length === 0) {
      return nodeCenter;
    }
    
    const normalizedDirection = {
      x: targetDirection.x / length,
      y: targetDirection.y / length
    };
    
    // Update uniform buffer with parameters
    const uniformData = new Float32Array([
      nodeCenter.x, nodeCenter.y,                    // nodeCenter
      normalizedDirection.x, normalizedDirection.y,  // targetDirection  
      maxDistance,                                    // maxDistance
      1.0,                                           // stepSize
      0.0, 0.0                                       // padding
    ]);
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    
    // Create bind group for this specific detection
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: nodeTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.edgeBuffer } },
        { binding: 3, resource: { buffer: this.uniformBuffer } }
      ],
      label: 'edge-detection-bind-group'
    });
    
    // Dispatch compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass({
      label: 'edge-detection-compute-pass'
    });
    
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(1);
    
    computePass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    
    // Read back the result
    const readBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'edge-detection-readback'
    });
    
    const copyEncoder = this.device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(this.edgeBuffer, 0, readBuffer, 0, 8);
    this.device.queue.submit([copyEncoder.finish()]);
    
    // Wait for GPU work to complete and read result
    await readBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(readBuffer.getMappedRange());
    const result = { x: resultData[0], y: resultData[1] };
    
    readBuffer.unmap();
    readBuffer.destroy();
    
    return result;
  }
  
  // Batch edge detection for multiple directions at once
  async detectMultipleEdgePoints(
    nodeTexture: GPUTexture,
    nodeCenter: {x: number, y: number},
    directions: Array<{x: number, y: number}>,
    maxDistance: number = 100
  ): Promise<Array<{x: number, y: number}>> {
    // For now, just call detectEdgePoint multiple times
    const results: Array<{x: number, y: number}> = [];
    
    for (const direction of directions) {
      const result = await this.detectEdgePoint(nodeTexture, nodeCenter, direction, maxDistance);
      results.push(result);
    }
    
    return results;
  }
  
  // Helper method to detect edge points for common directions
  async detectCardinalEdgePoints(
    nodeTexture: GPUTexture,
    nodeCenter: {x: number, y: number},
    maxDistance: number = 100
  ): Promise<{
    north: {x: number, y: number},
    south: {x: number, y: number},
    east: {x: number, y: number},
    west: {x: number, y: number}
  }> {
    const directions = [
      { x: 0, y: -1 },  // north
      { x: 0, y: 1 },   // south  
      { x: 1, y: 0 },   // east
      { x: -1, y: 0 }   // west
    ];
    
    const results = await this.detectMultipleEdgePoints(
      nodeTexture, 
      nodeCenter, 
      directions, 
      maxDistance
    );
    
    return {
      north: results[0],
      south: results[1],
      east: results[2],
      west: results[3]
    };
  }
  
  destroy() {
    this.edgeBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}