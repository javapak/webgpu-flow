/// <reference types="@webgpu/types" />
import type { DiagramEdge, DiagramNode, Viewport } from '../types';
import tgpu from 'typegpu'
import { LabelRenderer } from './LabelRenderer';
import { VisualContentRenderer } from './VisualContentRenderer';
import { Z_LAYERS } from '../utils/DepthConstants';
import { FloatingEdgeRenderer } from './FloatingEdgeRenderer';
import { VisualContentNodeManager } from '../compute/VisualContentNode';
import { ShaderBasedEdgeDetector } from '../compute/ShaderBasedEdgeDetector';
import GPUCapabilities from '../utils/GPUCapabilities';
import type { EdgeDrawingState } from '../components/DiagramProvider';
import { GridSnapping } from '../utils/GridSnapping';
import SupersamplingManager from './SupersamplingManager';
import { FXAARenderer } from './FXAARendererer';

interface NodeInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
  isSelected: number; // 0 or 1
  shapeType: number;
  padding: [number, number, number]; // padding for alignment
}

interface HandleInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
}

export class WebGPURenderer {
  private root: any = null;
  private context: GPUCanvasContext | null = null;
  private nodeRenderPipeline: GPURenderPipeline | null = null;
  private handleRenderPipeline: GPURenderPipeline | null = null;
  private gridRenderPipeline: GPURenderPipeline | null = null;
  private nodeBuffer: GPUBuffer | null = null;
  private handleBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private gridUniformBuffer: GPUBuffer | null = null;
  private nodeBindGroup: GPUBindGroup | null = null;
  private handleBindGroup: GPUBindGroup | null = null;
  private gridBindGroup: GPUBindGroup | null = null;
  private device: GPUDevice | null = null;
  public initialized = false;
  private canvas: HTMLCanvasElement | null = null;
  private labelRenderer: LabelRenderer | null = null;
  private visualRenderer: VisualContentRenderer | null = null;
  private _depthTexture: GPUTexture | null = null;
  private multisampledTexture: GPUTexture | null = null;
  private edgeRenderer: FloatingEdgeRenderer | null = null;
  private visualContentNodeManager: VisualContentNodeManager | null = null;
  private _gpuCapibilitiesRef: GPUCapabilities | null = null;
  private sampleCount: string = '1';
  private _isReconfiguring: boolean = false;
  private _isResizing: boolean = false;
  private _renderInProgress: boolean = false;
  private _supersamplingManager: SupersamplingManager | null = null;
  private fxaaRenderer: FXAARenderer | null = null;
  private fxaaEnabled: boolean = false;
  private intermediateTexture: GPUTexture | null = null; // For MSAA + FXAA



// In WebGPURenderer.ts, improve error handling in initialize():
  get isReconfiguring() {
    return this._isReconfiguring;
  }

  get gpuCapibilitiesRef() {
    return this._gpuCapibilitiesRef;
  }

  get supersamplingManager() {
    return this._supersamplingManager;
  }

  get isResizing() {
    return this._isResizing;
  }

  get depthTexture() {
    return this._depthTexture;
  }

  get isBusy() {
    return (this._isResizing || this._isReconfiguring || this._renderInProgress);
  }

  async initialize(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      if (!navigator.gpu) {
        console.warn('WebGPU not supported in this browser');
        return false;
      }

      this.canvas = canvas;
      
      // Initialize TypeGPU
      try {
        this.root = await tgpu.init();
        this.device = this.root.device;
      } catch (error) {
        console.error('❌ Failed to initialize TypeGPU:', error);
        return false;
      }
      
      // Check MSAA support
      try {
        this._gpuCapibilitiesRef = new GPUCapabilities(this.device!);
        const msaaSupport = await this._gpuCapibilitiesRef.checkMSAASupport();
        
        // Ensure we start with a supported sample count
        if (!msaaSupport.supportedCounts.includes(this.sampleCount)) {
          console.warn(`⚠️ Initial sample count ${this.sampleCount} not supported, using 1`);
          this.sampleCount = '1';
        }
      } catch (error) {
        console.error('❌ Failed to check MSAA support:', error);
        this.sampleCount = '1'; // Fallback to no MSAA
      }
      
      // Get WebGPU context
      this.context = canvas.getContext('webgpu') as GPUCanvasContext;
      if (!this.context) {
        console.error('❌ Failed to get WebGPU context');
        return false;
      }

      // Configure canvas
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      try {
        this.context.configure({
          device: this.device!,
          format: canvasFormat,
          alphaMode: 'premultiplied',
        });
      } catch (error) {
        console.error('❌ Failed to configure canvas:', error);
        return false;
      }

      // Setup render pipelines
      try {
        await this.setupRenderPipelines();
      } catch (error) {
        console.error('❌ Failed to setup render pipelines:', error);
        return false;
      }

      this.initialized = true;
      console.log('✅ WebGPU renderer core initialized');

      // Initialize label renderer
      try {
        this.labelRenderer = new LabelRenderer(this.device!, this.uniformBuffer!, this.sampleCount);
        await this.labelRenderer.initialize();
        console.log('✅ Label renderer initialized');
      } catch (error) {
        console.error('❌ Failed to initialize label renderer:', error);
        // Non-fatal - continue without labels
      }

      // Initialize edge renderer
      try {
        this.edgeRenderer = new FloatingEdgeRenderer(this.device!, canvasFormat, 20, 1000, this.sampleCount);
        console.log('✅ Edge renderer initialized');
      } catch (error) {
        console.error('❌ Failed to initialize edge renderer:', error);
        // Non-fatal - continue without edges
      }

      // Initialize visual renderer
      try {
        this.visualRenderer = new VisualContentRenderer(this.device!, this.uniformBuffer!, this.sampleCount);
        await this.visualRenderer.initialize();
        
        const edgeDetector = new ShaderBasedEdgeDetector(this.device!);
        this.visualContentNodeManager = new VisualContentNodeManager(edgeDetector, this.visualRenderer);
        console.log('✅ Visual renderer initialized');
      } catch (error) {
        console.error('❌ Failed to initialize visual renderer:', error);
        // Non-fatal - continue without visual content
      }

      try {
        this._supersamplingManager = new SupersamplingManager(this.device!, this.sampleCount);
      }
      catch (error) {
        console.log('SupersamplingManager init failed...');

      }

      // Create depth texture
      try {
        const sampleCountNum = parseInt(this.sampleCount);
        console.error(`Creating initial depth texture with sample count ${this.sampleCount}`);
        
        this._depthTexture = this.device!.createTexture({
          label: 'initial-depth-texture',
          size: [this.canvas.width, this.canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          sampleCount: sampleCountNum
        });

        if (sampleCountNum > 1) {
          console.log(`🎨 Creating initial multisampled texture with sample count ${this.sampleCount}`);
          this.multisampledTexture = this.device!.createTexture({
            label: 'initial-multisampled-texture',
            size: [this.canvas.width, this.canvas.height],
            format: canvasFormat,
            sampleCount: sampleCountNum,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
        }

        
        console.log('Depth textures created');
      } catch (error) {
        console.error('Failed to create depth textures:', error);
        return false;
      }

      try {
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.fxaaRenderer = new FXAARenderer(this.device!, canvasFormat);
      }
      catch (e) {

      }

      console.log('WebGPU renderer fully initialized');
      return true;
      
    } catch (error) {
      console.error('WebGPU initialization failed:', error);
      this.initialized = false;
      return false;
    }
  }

  get sampleCountsSupported() {
    return this._gpuCapibilitiesRef?.sampleCountsSupported;
  }

  get currentSampleCount(): string {
    return this.sampleCount;
  }

  async setSupersamplingFactor(factor: number) {
    if (!this.supersamplingManager || !this.canvas) return;
    
    this._isReconfiguring = true;
    
    try {
      this.supersamplingManager.setSupersamplingFactor(factor);
      
      if (factor > 1) {
        // Create supersampled textures
        const sampleCountNum = parseInt(this.sampleCount);
        
        this.supersamplingManager.createSupersampledTextures(
          this.canvas.width,
          this.canvas.height,
          sampleCountNum,
          navigator.gpu.getPreferredCanvasFormat()
        );
        
        console.log(`✓ Supersampling configured: ${factor}x with ${sampleCountNum}x MSAA`);
      } else {
        console.log('✓ Supersampling disabled');
      }
      
    } catch (error) {
      console.error('Failed to set supersampling:', error);
      // Fallback to disabled
      this.supersamplingManager.setSupersamplingFactor(1);
    } finally {
      this._isReconfiguring = false;
    }
  }

  private createIntermediateTexture(width: number, height: number) {
    if (this.intermediateTexture) {
      this.intermediateTexture.destroy();
    }

    this.intermediateTexture = this.device!.createTexture({
      size: { width, height },
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'intermediate-texture-for-fxaa'
    });
  }

  setFXAAEnabled(enabled: boolean) {
    this.fxaaEnabled = enabled;
    console.log(`FXAA ${enabled ? 'enabled' : 'disabled'}`);
  }


  async setSampleCount(count: string) {
    if (!this._gpuCapibilitiesRef?.sampleCountsSupported?.includes(count)) {
      console.warn(`Sample count ${count} not supported`);
      return;
    }

    if (this.sampleCount === count) {
      console.log(`✓ Sample count already ${count}, no changes needed`);
      return;
    } 
    
    console.log(`Starting sample count change from ${this.sampleCount} to ${count}`);
    
    // IMMEDIATELY set reconfiguring flag before anything else
    this._isReconfiguring = true;
    
    // Wait a frame to ensure any in-flight renders complete
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    if (this.canvas && this.device) {
      const sampleCountNum = parseInt(count);
      
      try {
        
        // Destroy all renderers first (they may have pending operations)
        if (this.labelRenderer) {
          this.labelRenderer.destroy();
          this.labelRenderer = null;
        }
        if (this.visualRenderer) {
          this.visualRenderer.destroy();
          this.visualRenderer = null;
        }
        if (this.edgeRenderer) {
          this.edgeRenderer.destroy();
          this.edgeRenderer = null;
        }
        
        // Wait again after destroying renderers
        await this.device.queue.onSubmittedWorkDone();
        console.log('Renderers destroyed');
        
        // Destroy textures
        if (this._depthTexture) {
          this._depthTexture.destroy();
          this._depthTexture = null;
        }
        if (this.multisampledTexture) {
          this.multisampledTexture.destroy();
          this.multisampledTexture = null;
        }
        
        // Wait a bit for GPU to fully release resources
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('✅ Textures destroyed');
        
        // Update sample count
        this.sampleCount = count;
        
        // Create new textures
        this._depthTexture = this.device.createTexture({
          label: `depth-texture-msaa-${count}`,
          size: [this.canvas.width, this.canvas.height],
          format: 'depth24plus',
          sampleCount: sampleCountNum,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        
        if (sampleCountNum > 1) {
          this.multisampledTexture = this.device.createTexture({
            label: `multisampled-color-${count}`,
            size: [this.canvas.width, this.canvas.height],
            format: navigator.gpu.getPreferredCanvasFormat(),
            sampleCount: sampleCountNum,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
        }
        console.log('New textures created');
        
        // Recreate pipelines
        await this.setupRenderPipelines();
        

        // Recreate renderers
        this.labelRenderer = new LabelRenderer(this.device, this.uniformBuffer!, count);
        await this.labelRenderer.initialize();
        
        this.visualRenderer = new VisualContentRenderer(this.device, this.uniformBuffer!, count);
        await this.visualRenderer.initialize();
        
        const edgeDetector = new ShaderBasedEdgeDetector(this.device);
        this.visualContentNodeManager = new VisualContentNodeManager(edgeDetector, this.visualRenderer);
        
        this.edgeRenderer = new FloatingEdgeRenderer(
          this.device,
          navigator.gpu.getPreferredCanvasFormat(),
          20,
          1000,
          count
        );

        this.supersamplingManager?.updateSampleCount(count);

        this.supersamplingManager?.createSupersampledTextures(
            this.canvas.width,
            this.canvas.height,
            sampleCountNum,
            navigator.gpu.getPreferredCanvasFormat()
        );
        console.log('Renderers recreated');
        
        console.log(`Sample count change complete: ${count}x MSAA`);
      } catch (error) {
        console.error('Error during sample count change:', error);
      } finally {
        this._isReconfiguring = false;
        this._renderInProgress = false;
      }
    } else {
      this._isReconfiguring = false;
    }
  }

  private async setupRenderPipelines() {
    if (!this.device) throw new Error('Device not initialized');

    // Create buffers
    this.uniformBuffer = this.device.createBuffer({
      size: 80, // mat4x4 (64 bytes) + vec4 (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Grid uniform buffer now includes canvas size
    this.gridUniformBuffer = this.device.createBuffer({
      size: 96, // mat4x4 (64 bytes) + vec4 viewport (16 bytes) + vec4 canvas size (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.nodeBuffer = this.device.createBuffer({
      size: 1000 * 64, // Support up to 1000 nodes (16 floats * 4 bytes each = 64 bytes per node)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.handleBuffer = this.device.createBuffer({
      size: 8 * 32, // Up to 8 handles per selected node (8 floats * 4 bytes each)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    


    // Fixed WGSL shader with proper shape handling
    const nodeShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
      }

      struct NodeData {
        position: vec2<f32>,
        size: vec2<f32>,
        color: vec4<f32>,
        isSelected: f32,
        shapeType: f32,
        padding: vec3<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var<storage, read> nodeData: array<NodeData>;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
        @location(2) isSelected: f32,
        @location(3) shapeType: f32,
        @location(4) nodeSize: vec2<f32>
      }

      @vertex
      fn vs_main(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) instanceIndex: u32
      ) -> VertexOutput {
        // Quad vertices for instanced rendering
        let positions = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        
        let uvs = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
        );

        let node = nodeData[instanceIndex];
        var localPos = positions[vertexIndex];
        
        let nodeSize = node.size;
        
        localPos.y = -localPos.y;
        let worldPos = node.position + localPos * nodeSize * 0.5;
        
        var output: VertexOutput;
        // Apply view-projection matrix
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${Z_LAYERS.NODES}, 1.0);
        output.color = node.color;
        output.uv = uvs[vertexIndex];
        output.isSelected = node.isSelected;
        output.nodeSize = node.size;
        output.shapeType = node.shapeType;
        
        return output;
      }
      
      // Distance functions for different shapes
      fn sdRectangle(p: vec2<f32>, b: vec2<f32>) -> f32 {
        let d = abs(p) - b;
        return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
      }

      fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
        return length(p) - r;
      }

      fn sdDiamond(p: vec2<f32>, b: vec2<f32>) -> f32 {
        let q = abs(p);
        let h = b.x + b.y;
        return (q.x + q.y - h) / sqrt(2.0);
      }

      fn sdHexagon(p: vec2<f32>, r: f32) -> f32 {
        let k = vec3<f32>(-0.866025404, 0.5, 0.577350269);
        let q = abs(p);
        let qx_k1 = q.x * k.x;
        let qy_k2 = q.y * k.y;
        let dot_qk = qx_k1 + qy_k2;
        let q2 = vec2<f32>(q.x - 2.0 * min(dot_qk, 0.0) * k.x, q.y - 2.0 * min(dot_qk, 0.0) * k.y);
        let q3 = vec2<f32>(q2.x - clamp(q2.x, -k.z * r, k.z * r), q2.y - r);
        return length(q3) * sign(q3.y);
      }

      fn sdRoundedRectangle(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
        let q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
      }

      fn sdOval(p: vec2<f32>, ab: vec2<f32>) -> f32 {
        let p2 = p * p;
        let ab2 = ab * ab;
        return (p2.x / ab2.x + p2.y / ab2.y - 1.0);
      }

      fn sdActor(p: vec2<f32>) -> f32 {
        // Simplified stick figure - head (circle) + body (rectangle) - fixed Y axis
        let head = sdCircle(p + vec2<f32>(0.0, -0.4), 0.2); // Fixed Y
        let body = sdRectangle(p + vec2<f32>(0.0, 0.1), vec2<f32>(0.15, 0.4)); // Fixed Y
        return min(head, body);
      }

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let uv = input.uv * 2.0 - 1.0; // Convert to [-1, 1] range
        let aspectRatio = input.nodeSize.x / input.nodeSize.y;
        
        // For shapes that should maintain aspect ratio, use different coordinates
        let p = vec2<f32>(uv.x * aspectRatio, uv.y);
        let p_square = uv; // For shapes that should ignore aspect ratio
        
        var distance: f32;
        let shapeType = i32(input.shapeType + 0.5); // Round to nearest integer
        
        // Clean switch statement with proper aspect ratio handling
        switch (shapeType) {
          case 0: { // Rectangle - use full bounds
            distance = sdRectangle(p, vec2<f32>(aspectRatio * 0.95, 0.95));
          }
          case 1: { // Circle - use full bounds
            distance = sdCircle(p_square, 0.95);
          }
          case 2: { // Diamond - use full bounds  
            distance = sdDiamond(uv, vec2<f32>(0, 0.95));
          }
          case 3: { // Hexagon - use full bounds
            let avgRadius = 0.9 * sqrt(aspectRatio);
            distance = sdHexagon(p_square, avgRadius);
          }
          case 4: { // Package - use full bounds
            let mainBody = sdRoundedRectangle(p, vec2<f32>(aspectRatio * 0.85, 0.75), 0.1);
            let tab = sdRectangle(p + vec2<f32>(0.0, -0.85), vec2<f32>(aspectRatio * 0.4, 0.1));
            distance = min(mainBody, tab);
          }
          case 5: { // Rounded Rectangle - use full bounds
            distance = sdRoundedRectangle(p, vec2<f32>(aspectRatio * 0.95, 0.95), 0.1);
          }
          case 6: { // Initial Node - use full bounds
            distance = sdCircle(p_square, 0.95);
          }
          case 7: { // Final Node - use full bounds with ring
            let outer = sdCircle(p_square, 0.95);
            let inner = sdCircle(p_square, 0.7);
            distance = max(outer, -inner); // Ring shape
          }
          case 8: { // Oval - use full bounds
            distance = sdOval(p, vec2<f32>(aspectRatio * 0.95, 0.85));
          }
          case 9: { // Actor - use full bounds
            distance = sdActor(p_square);
          }

        
          case 10: {
            discard;
          }

          default: { // Default to rectangle
            distance = sdRectangle(p, vec2<f32>(aspectRatio * 0.95, 0.95));
          }
      }

        // Anti-aliasing with better smoothing
        var smoothWidth = 0.01;
        if (input.nodeSize.x < 40.0 || input.nodeSize.y < 40.0) {
          smoothWidth = 0.05; // Wider smoothing for small nodes
        }
        if (input.nodeSize.x < 20.0 || input.nodeSize.y < 20.0) {
          smoothWidth = 0.1; // Even wider for very small nodes
        }
          

        let alpha = 1.0 - smoothstep(-smoothWidth, smoothWidth, distance);
        
        // Discard pixels that are completely transparent
        if (alpha < 0.01) {
          discard;
        }
        
        var finalColor = input.color;
        
        // Selection highlight
        if (input.isSelected > 0.5) {
          let selectionGlow = exp(-abs(distance) * 6.0) * 0.4;
          let selectionColor = vec4<f32>(0.2, 0.7, 1.0, 1.0);
          finalColor = mix(finalColor, selectionColor, selectionGlow);
        }
        
        // Border effect for better definition
        let borderWidth = 0.0;
        let borderDistance = abs(distance + borderWidth);
        let borderAlpha = 1.0 - smoothstep(0.0, borderWidth, borderDistance);
        let borderColor = vec4<f32>(0.1, 0.1, 0.1, 1.0);
        finalColor = mix(finalColor, borderColor, borderAlpha * 0.6);
        
        return vec4<f32>(finalColor.rgb, finalColor.a * alpha);
      }
    `;

    // Updated grid shader for dynamic canvas sizing
    const gridShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
        canvasSize: vec4<f32>, // width, height, padding, padding
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
      }

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        // Grid configuration
        let gridSize = ${GridSnapping.getDefaultGridSize()}.0; // Grid spacing in world units
        let lineWidth = max(1.0 / uniforms.viewport.z, 0.5); // Adaptive line width
        
        // Get actual canvas dimensions from uniform
        let canvasWidth = uniforms.canvasSize.x;
        let canvasHeight = uniforms.canvasSize.y;
        
        // Calculate visible world bounds based on current viewport and zoom
        let worldWidth = canvasWidth / uniforms.viewport.z;
        let worldHeight = canvasHeight / uniforms.viewport.z;
        let left = uniforms.viewport.x - worldWidth / 2.0;
        let right = uniforms.viewport.x + worldWidth / 2.0;
        let top = uniforms.viewport.y - worldHeight / 2.0;
        let bottom = uniforms.viewport.y + worldHeight / 2.0;
        
        let margin = gridSize * 2.0;
        let gridLeft = floor((left - margin) / gridSize) * gridSize;
        let gridRight = ceil((right + margin) / gridSize) * gridSize;
        let gridTop = floor((top - margin) / gridSize) * gridSize;
        let gridBottom = ceil((bottom + margin) / gridSize) * gridSize;
        
        let numVerticalLines = i32((gridRight - gridLeft) / gridSize) + 1;
        let numHorizontalLines = i32((gridBottom - gridTop) / gridSize) + 1;
        let verticesPerLine = 6; // 2 triangles per line
        
        // Determine which line and which vertex within that line
        let lineIndex = vertexIndex / u32(verticesPerLine);
        let vertexInLine = vertexIndex % u32(verticesPerLine);
        
        var worldPos: vec2<f32>;
        
        if (lineIndex < u32(numVerticalLines)) {
          // Vertical line
          let x = gridLeft + f32(lineIndex) * gridSize;
          switch (vertexInLine) {
            case 0u: { worldPos = vec2<f32>(x - lineWidth/2.0, gridTop); }
            case 1u: { worldPos = vec2<f32>(x + lineWidth/2.0, gridTop); }
            case 2u: { worldPos = vec2<f32>(x - lineWidth/2.0, gridBottom); }
            case 3u: { worldPos = vec2<f32>(x + lineWidth/2.0, gridTop); }
            case 4u: { worldPos = vec2<f32>(x + lineWidth/2.0, gridBottom); }
            case 5u: { worldPos = vec2<f32>(x - lineWidth/2.0, gridBottom); }
            default: { worldPos = vec2<f32>(x, gridTop); }
          }
        } else {
          // Horizontal line
          let lineIdx = lineIndex - u32(numVerticalLines);
          let y = gridTop + f32(lineIdx) * gridSize;
          switch (vertexInLine) {
            case 0u: { worldPos = vec2<f32>(gridLeft, y - lineWidth/2.0); }
            case 1u: { worldPos = vec2<f32>(gridRight, y - lineWidth/2.0); }
            case 2u: { worldPos = vec2<f32>(gridLeft, y + lineWidth/2.0); }
            case 3u: { worldPos = vec2<f32>(gridRight, y - lineWidth/2.0); }
            case 4u: { worldPos = vec2<f32>(gridRight, y + lineWidth/2.0); }
            case 5u: { worldPos = vec2<f32>(gridLeft, y + lineWidth/2.0); }
            default: { worldPos = vec2<f32>(gridLeft, y); }
          }
        }
        
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, ${Z_LAYERS.BACKGROUND}, 1.0);
        
        // Grid color - adaptive opacity based on zoom
        let baseAlpha = 0.25;
        let zoomFactor = uniforms.viewport.z;
        let alpha = clamp(baseAlpha * min(zoomFactor * 0.8, 1.2), 0.08, 0.4);
        output.color = vec4<f32>(0.7, 0.7, 0.7, alpha);
        
        return output;
      }

      @fragment
      fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
        return color;
      }
    `;

    const handleShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>,
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
          vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0)
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
        // Simple square handles with border
        let borderWidth = 0.15;
        let center = abs(uv - 0.5);
        let isInBorder = step(center.x, 0.5 - borderWidth) * step(center.y, 0.5 - borderWidth);
        
        if (isInBorder > 0.5) {
          return vec4<f32>(0.1, 0.1, 0.1, 1.0); // Dark interior
        } else {
          return color; // Bright border
        }
      }
    `;

    const nodeShaderModule = this.device.createShaderModule({ code: nodeShaderCode });
    const handleShaderModule = this.device.createShaderModule({ code: handleShaderCode });
    const gridShaderModule = this.device.createShaderModule({ code: gridShaderCode });

    // Create bind group layouts
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' as const }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' as const }
        }
      ]
    });

    // Grid bind group layout needs to match the new uniform structure
    const gridBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' as const }

        }
      ]
    });

    // Create bind groups
    this.nodeBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } }
      ]
    });

    this.handleBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.handleBuffer } }
      ]
    });

    this.gridBindGroup = this.device.createBindGroup({
      layout: gridBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.gridUniformBuffer } }
      ]
    });

    // Create render pipelines
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });

    const gridPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [gridBindGroupLayout]
    });

    this.nodeRenderPipeline = this.device.createRenderPipeline({
      label: 'node-render-pipeline',
      layout: pipelineLayout,
      vertex: {
        module: nodeShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: nodeShaderModule,
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
        depthWriteEnabled: true,
        depthCompare: 'less', 
      },
      multisample: {count: parseInt(this.sampleCount)}
    });

    this.handleRenderPipeline = this.device.createRenderPipeline({
      label: 'handle-render-pipeline',
      layout: pipelineLayout,
      vertex: {
        module: handleShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: handleShaderModule,
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
      primitive: { topology: 'triangle-list'},
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less', 
      },
      multisample: {count: parseInt(this.sampleCount)}

    });

    this.gridRenderPipeline = this.device.createRenderPipeline({
      label: 'grid-render-pipeline',
      layout: gridPipelineLayout,
      vertex: {
        module: gridShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: gridShaderModule,
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
        depthWriteEnabled: true,
        depthCompare: 'less', 
      },
      multisample: {count: parseInt(this.sampleCount)}

    });
  }
  
   async updateDepthTextureOnSizeChange(canvasSize: { width: number; height: number }) {
    if (!this.device || !this.canvas) {
      console.log('⚠️ No device or canvas');
      return;
    }
    
    // Block all operations during reconfiguration or rendering
    if (this.isBusy) {
      console.log('Skipping resize - system busy');
      return;
    }
    
    // Validate size
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      console.warn('Invalid canvas size:', canvasSize);
      return;
    }


    
    
    
    // Set ONLY the resize flag - don't block rendering completely
    this._isResizing = true;
    
    try {
      // Simple approach: just wait for current GPU work
      
      const sampleCountNum = parseInt(this.sampleCount);
      
      // Destroy old textures
      if (this._depthTexture) {
        this._depthTexture.destroy();
        this._depthTexture = null;
      }
      if (this.multisampledTexture) {
        this.multisampledTexture.destroy();
        this.multisampledTexture = null;
      }
      
      // Update canvas size
      this.canvas.width = canvasSize.width;
      this.canvas.height = canvasSize.height;
      
      // Recreate textures immediately
      this._depthTexture = this.device.createTexture({
        label: `depth-${canvasSize.width}x${canvasSize.height}`,
        size: { width: canvasSize.width, height: canvasSize.height },
        sampleCount: sampleCountNum,
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      
      if (sampleCountNum > 1) {
        this.multisampledTexture = this.device.createTexture({
          label: `msaa-${canvasSize.width}x${canvasSize.height}`,
          size: { width: canvasSize.width, height: canvasSize.height },
          format: navigator.gpu.getPreferredCanvasFormat(),
          sampleCount: sampleCountNum,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      
      console.log(`Resize complete: ${canvasSize.width}x${canvasSize.height}`);
      
    } catch (error) {
      console.error('Resize error:', error);
      
      // Simple recovery: recreate with sample count 1
      try {
        if (this.canvas.width === 0) this.canvas.width = canvasSize.width || 800;
        if (this.canvas.height === 0) this.canvas.height = canvasSize.height || 600;
        
        this._depthTexture = this.device.createTexture({
          label: 'recovery-depth',
          size: { width: this.canvas.width, height: this.canvas.height },
          sampleCount: 1,
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        
        this.multisampledTexture = null;
        this.sampleCount = '1';
        
        console.log('Recovered with MSAA disabled');
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError);
        this.initialized = false;
      }
    } finally {
      this._isResizing = false;
    }
  }

  async render(
    visibleNodes: DiagramNode[],
    visibleEdges: DiagramEdge[],
    viewport: Viewport,
    canvasSize: { width: number; height: number },
    selectedNodes: DiagramNode[] = [],
    selectedEdges: DiagramEdge[] = [],
    previewEdge?: EdgeDrawingState | null
  ): Promise<void> {
    if (!this.initialized || !this.device || !this.context || !this.nodeRenderPipeline) {
      console.warn('WebGPU renderer not properly initialized');
      return;
    }

    if (this._isReconfiguring) {
      console.log('Skipping render - reconfiguring');
      return;
    }

    if (!this._depthTexture || !this.uniformBuffer) {
      return;
    }

    this._renderInProgress = true;

    try {
      // Validate input data
      if (!Array.isArray(visibleNodes)) {
        console.error('visibleNodes is not an array:', visibleNodes);
        return;
      }

      if (!Array.isArray(selectedNodes)) {
        console.error('selectedNodes is not an array:', selectedNodes);
        return;
      }

      if (this.canvas && (this.canvas.width !== canvasSize.width || this.canvas.height !== canvasSize.height)) {
        console.log("Canvas size changed, will update on next frame");
        requestAnimationFrame(() => {
          this.updateDepthTextureOnSizeChange(canvasSize);
        });
        return;
      }

      let canvasTexture: GPUTexture;
      try {
        canvasTexture = this.context.getCurrentTexture();
      } catch (e) {
        console.log('Canvas texture unavailable');
        return;
      }

      const useFXAA = this.fxaaEnabled;
      const useMSAA = parseInt(this.sampleCount) > 1;

      // Ensure intermediate texture exists if FXAA is enabled
      if (useFXAA) {
        if (!this.intermediateTexture || 
            this.intermediateTexture.width !== canvasSize.width ||
            this.intermediateTexture.height !== canvasSize.height) {
          this.createIntermediateTexture(canvasSize.width, canvasSize.height);
        }
      }

      // Determine render target configuration
      let colorAttachmentView: GPUTextureView;
      let resolveTarget: GPUTextureView | undefined;
      let depthAttachmentView: GPUTextureView;
      
      if (useFXAA && useMSAA) {
        // MSAA + FXAA: Render with MSAA → resolve to intermediate → FXAA → canvas
        colorAttachmentView = this.multisampledTexture!.createView();
        resolveTarget = this.intermediateTexture!.createView();
        
      } else if (useFXAA && !useMSAA) {
        // FXAA only: Render → intermediate → FXAA → canvas
        colorAttachmentView = this.intermediateTexture!.createView();
        resolveTarget = undefined;
        
      } else if (!useFXAA && useMSAA) {
        // MSAA only: Render with MSAA → resolve to canvas
        colorAttachmentView = this.multisampledTexture!.createView();
        resolveTarget = canvasTexture.createView();
        
      } else {
        // Neither: Render directly to canvas
        colorAttachmentView = canvasTexture.createView();
        resolveTarget = undefined;
      }
      
      depthAttachmentView = this._depthTexture!.createView();

      // Create view-projection matrix
      const viewProjectionMatrix = this.createViewProjectionMatrix(viewport, canvasSize);

      // Update uniform buffers
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height
        ])
      );

      this.device.queue.writeBuffer(
        this.gridUniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height,
          canvasSize.width, canvasSize.height, 0, 0
        ])
      );

      // Prepare node data (your existing code)
      const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
      const nodeData: NodeInstanceData[] = visibleNodes.map(node => {
        if (!node.data || !node.data.position) {
          console.warn('Invalid node structure:', node);
          return null;
        }
        
        let color = this.hexToRgba(node.visual?.color || '#3b82f6');
        const size = node.visual?.size || { width: 100, height: 60 };
        
        let shapeType = SHAPE_TYPES[node.visual?.shape as keyof typeof SHAPE_TYPES] ?? 0;
        if (node.visual?.shape === 'none') {
          color = this.hexToRgba('#00000000');
          shapeType = 10;
        }

        const isSelected = selectedNodeIds.has(node.id) ? 1 : 0;
        
        return {
          position: [node.data.position.x, node.data.position.y],
          size: [size.width, size.height],
          color: [color.r, color.g, color.b, color.a],
          shapeType,
          isSelected,
          padding: [0, 0, 0],
        };
      }).filter(Boolean) as NodeInstanceData[];

      // Create command encoder
      const commandEncoder = this.device.createCommandEncoder();

      // Setup color attachment
      let colorAttachment: GPURenderPassColorAttachment = {
        view: colorAttachmentView,
        clearValue: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      };
      
      if (resolveTarget) {
        colorAttachment.resolveTarget = resolveTarget;
      }

      // Main render pass
      const renderPass = commandEncoder.beginRenderPass({
        label: 'main-render-pass',
        colorAttachments: [colorAttachment], 
        depthStencilAttachment: {
          view: depthAttachmentView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        }
      });

      // Render grid
      this.renderGrid(renderPass, viewport, canvasSize);

      // Render nodes if we have data
      if (nodeData.length > 0) {
        // Update node buffer (your existing code)
        const requiredNodeSize = nodeData.length * 64;
        if (requiredNodeSize > this.nodeBuffer!.size) {
          this.nodeBuffer!.destroy();
          this.nodeBuffer = this.device.createBuffer({
            size: requiredNodeSize * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          
          this.nodeBindGroup = this.device.createBindGroup({
            layout: this.nodeRenderPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.uniformBuffer! } },
              { binding: 1, resource: { buffer: this.nodeBuffer } }
            ]
          });
        }

        const flatNodeData = new Float32Array(nodeData.length * 16);
        nodeData.forEach((node, i) => {
          const offset = i * 16;
          flatNodeData[offset] = node.position[0];
          flatNodeData[offset + 1] = node.position[1];
          flatNodeData[offset + 2] = node.size[0];
          flatNodeData[offset + 3] = node.size[1];
          flatNodeData[offset + 4] = node.color[0];
          flatNodeData[offset + 5] = node.color[1];
          flatNodeData[offset + 6] = node.color[2];
          flatNodeData[offset + 7] = node.color[3];
          flatNodeData[offset + 8] = node.isSelected;
          flatNodeData[offset + 9] = node.shapeType;
          flatNodeData[offset + 10] = node.padding[0];
          flatNodeData[offset + 11] = node.padding[1];
          flatNodeData[offset + 12] = node.padding[2];
          flatNodeData[offset + 13] = 0;
          flatNodeData[offset + 14] = 0;
          flatNodeData[offset + 15] = 0;
        });

        this.device.queue.writeBuffer(this.nodeBuffer!, 0, flatNodeData);

        // Draw nodes
        renderPass.setPipeline(this.nodeRenderPipeline);
        renderPass.setBindGroup(0, this.nodeBindGroup!);
        renderPass.draw(6, nodeData.length);
      }

      // Render handles (your existing code for selected nodes)
      const handleData: HandleInstanceData[] = [];
      if (selectedNodes.length > 0) {
        const handleSize = Math.max(12 / viewport.zoom, 8);

        selectedNodes.forEach(node => {
          if (!node.data || !node.data.position) return;
          
          const size = node.visual?.size || { width: 100, height: 100 };
          const shape = node.visual?.shape || 'rectangle';
          const { x, y } = node.data.position;
          
          const handlePositions = this.getShapeHandlePositions(x, y, size.width, size.height, shape);
          
          handlePositions.forEach(handlePos => {
            const isCorner = handlePos.type === 'corner';
            const handleColor: [number, number, number, number] = isCorner ? [1.0, 1.0, 1.0, 1.0] : [0.8, 0.8, 1.0, 1.0];
            
            handleData.push({
              position: [handlePos.x, handlePos.y],
              size: [handleSize, handleSize],
              color: handleColor,
            });
          });
        });
      }

      if (handleData.length > 0 && this.handleRenderPipeline) {
        const requiredHandleSize = handleData.length * 32;
        if (requiredHandleSize > this.handleBuffer!.size) {
          this.handleBuffer!.destroy();
          this.handleBuffer = this.device.createBuffer({
            size: requiredHandleSize * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          
          this.handleBindGroup = this.device.createBindGroup({
            layout: this.handleRenderPipeline!.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.uniformBuffer! } },
              { binding: 1, resource: { buffer: this.handleBuffer } }
            ]
          });
        }

        const flatHandleData = new Float32Array(handleData.length * 8);
        handleData.forEach((handle, i) => {
          const offset = i * 8;
          flatHandleData[offset] = handle.position[0];
          flatHandleData[offset + 1] = handle.position[1];
          flatHandleData[offset + 2] = handle.size[0];
          flatHandleData[offset + 3] = handle.size[1];
          flatHandleData[offset + 4] = handle.color[0];
          flatHandleData[offset + 5] = handle.color[1];
          flatHandleData[offset + 6] = handle.color[2];
          flatHandleData[offset + 7] = handle.color[3];
        });

        this.device.queue.writeBuffer(this.handleBuffer!, 0, flatHandleData);
        
        renderPass.setPipeline(this.handleRenderPipeline);
        renderPass.setBindGroup(0, this.handleBindGroup!);
        renderPass.draw(6, handleData.length);
      }

      // Render edges, labels, visual content (your existing code)
      if (this.labelRenderer && visibleNodes.some((node: DiagramNode) => node.data?.label)) {
        try {
          const labelData = this.labelRenderer.prepareLabelData(visibleNodes, visibleEdges, viewport);
          const visualData = await this.visualRenderer?.prepareVisualData(visibleNodes);

          await this.edgeRenderer!.render(
            renderPass,
            visibleEdges,
            visibleNodes,
            viewProjectionMatrix,
            this.visualContentNodeManager!,
            previewEdge ? previewEdge : undefined,
            selectedEdges,
            viewport
          );

          if (visualData?.length) {
            this.visualRenderer?.render(renderPass, visualData);
          }
          
          if (labelData.length > 0) {
            this.labelRenderer.render(renderPass, labelData);
          }
        } catch (error) {
          console.error('Error rendering labels:', error);
        }
      }

      renderPass.end();

      // Apply FXAA if enabled
      if (useFXAA && this.fxaaRenderer && this.intermediateTexture) {
        this.fxaaRenderer.apply(commandEncoder, this.intermediateTexture, canvasTexture);
      }

      this.device.queue.submit([commandEncoder.finish()]);

    } catch (error) {
      console.error('Render error:', error);
    } finally {
      this._renderInProgress = false;
    }
  }

  clearTextAtlas(): void {
    if (this.labelRenderer) {
      this.labelRenderer.clearAtlas();
    }
  }

  getTextAtlasStats() {
    return this.labelRenderer?.getAtlasStats() || null;
  }

  getTextAtlasDebugCanvas(): HTMLCanvasElement | null {
    return this.labelRenderer?.getDebugCanvas() || null;
  }

  // Helper method to render grid with proper vertex calculation
  private renderGrid(renderPass: GPURenderPassEncoder, viewport: Viewport, canvasSize: { width: number; height: number }) {
    if (!this.gridRenderPipeline) return;

    // Calculate grid vertices dynamically based on current viewport and canvas size
    const gridSize = 50.0;
    const worldWidth = canvasSize.width / viewport.zoom;
    const worldHeight = canvasSize.height / viewport.zoom;
    const left = viewport.x - worldWidth / 2;
    const right = viewport.x + worldWidth / 2;
    const top = viewport.y - worldHeight / 2;
    const bottom = viewport.y + worldHeight / 2;
    
    // Add margin and snap to grid
    const margin = gridSize * 2;
    const gridLeft = Math.floor((left - margin) / gridSize) * gridSize;
    const gridRight = Math.ceil((right + margin) / gridSize) * gridSize;
    const gridTop = Math.floor((top - margin) / gridSize) * gridSize;
    const gridBottom = Math.ceil((bottom + margin) / gridSize) * gridSize;
    
    const numVerticalLines = Math.floor((gridRight - gridLeft) / gridSize) + 1;
    const numHorizontalLines = Math.floor((gridBottom - gridTop) / gridSize) + 1;
    const totalVertices = (numVerticalLines + numHorizontalLines) * 6; // 6 vertices per line

    console.log('Grid calculation:', {
      canvasSize,
      viewport,
      worldBounds: { left, right, top, bottom },
      gridBounds: { gridLeft, gridRight, gridTop, gridBottom },
      lines: { vertical: numVerticalLines, horizontal: numHorizontalLines },
      totalVertices
    });

    if (totalVertices > 0) {
      renderPass.setPipeline(this.gridRenderPipeline);
      renderPass.setBindGroup(0, this.gridBindGroup!);
      renderPass.draw(totalVertices, 1);
      console.log('Grid rendered with', totalVertices, 'vertices');
    }
  }

  private createViewProjectionMatrix(viewport: Viewport, canvasSize: { width: number; height: number }): number[] {

    const worldWidth = canvasSize.width / viewport.zoom;
    const worldHeight = canvasSize.height / viewport.zoom;
    
    const left = viewport.x - worldWidth / 2;
    const right = viewport.x + worldWidth / 2;
    const bottom = viewport.y + worldHeight / 2;
    const top = viewport.y - worldHeight / 2;
    
    const orthoMatrix = this.createOrthographicMatrix(left, right, bottom, top, -50, 50);
    
    return orthoMatrix;
  }

  private createOrthographicMatrix(
    left: number, right: number,
    bottom: number, top: number,
    near: number, far: number
  ): number[] {
    const width = right - left;
    const height = top - bottom;
    const depth = far - near;

    return [
      2 / width, 0, 0, 0,
      0, 2 / height, 0, 0,
      0, 0, -2 / depth, 0,
      -(right + left) / width, -(top + bottom) / height, -(far + near) / depth, 1,
    ];
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

  destroy(): void {
    try {
      if (this.nodeBuffer) {
        this.nodeBuffer.destroy();
        this.nodeBuffer = null;
      }

      if (this.intermediateTexture) {
        this.intermediateTexture.destroy();
        this.intermediateTexture = null;
      }

      if (this.fxaaRenderer) {
        this.fxaaRenderer.destroy();
        this.fxaaRenderer = null;
      }
      
      if (this.handleBuffer) {
        this.handleBuffer.destroy();
        this.handleBuffer = null;
      }
      
      if (this._depthTexture) {
        this._depthTexture.destroy();
        this._depthTexture = null;
      }
      
      if (this.multisampledTexture) {
        this.multisampledTexture.destroy();
        this.multisampledTexture = null;
      }

      if (this.labelRenderer) {
        this.labelRenderer.destroy();
        this.labelRenderer = null;
      }

      if (this.visualRenderer) {
        this.visualRenderer.destroy();
        this.visualRenderer = null;
      }
      
      if (this.uniformBuffer) {
        this.uniformBuffer.destroy();
        this.uniformBuffer = null;
      }

      if (this.gridUniformBuffer) {
        this.gridUniformBuffer.destroy();
        this.gridUniformBuffer = null;
      }

      this.root = null;
      this.context = null;
      this.nodeRenderPipeline = null;
      this.handleRenderPipeline = null;
      this.gridRenderPipeline = null;
      this.nodeBindGroup = null;
      this.handleBindGroup = null;
      this.gridBindGroup = null;
      this.device = null;
      this.initialized = false;
      this.canvas = null;

      console.log('WebGPU renderer destroyed');
    } catch (error) {
      console.error('Error destroying renderer:', error);
    }
  }

 private getShapeHandlePositions(
  centerX: number, 
  centerY: number, 
  width: number, 
  height: number, 
  shape: string
): Array<{x: number, y: number, type: 'corner' | 'edge'}> {
  const handles: Array<{x: number, y: number, type: 'corner' | 'edge'}> = [];
  
  switch (shape) {
    case 'circle':
    case 'initialNode':
    case 'finalNode': {
      // Circles work well with radial handles
      const radius = Math.max(width, height) / 2 * 0.95;
      handles.push(
        { x: centerX, y: centerY - radius, type: 'edge' },        // North
        { x: centerX + radius, y: centerY, type: 'edge' },        // East
        { x: centerX, y: centerY + radius, type: 'edge' },        // South
        { x: centerX - radius, y: centerY, type: 'edge' },        // West
        // Diagonal handles for better control
        { x: centerX + radius * 0.707, y: centerY - radius * 0.707, type: 'corner' }, // NE
        { x: centerX + radius * 0.707, y: centerY + radius * 0.707, type: 'corner' },  // SE
        { x: centerX - radius * 0.707, y: centerY + radius * 0.707, type: 'corner' },  // SW
        { x: centerX - radius * 0.707, y: centerY - radius * 0.707, type: 'corner' },  // NW
      );
      return handles;
    }
    
    case 'diamond': {
      const halfWidth = width / 2 * 0.95;
      const halfHeight = height / 2 * 0.95;
      handles.push(
        { x: centerX, y: centerY - halfHeight, type: 'corner' },     // Top
        { x: centerX + halfWidth, y: centerY, type: 'corner' },      // Right
        { x: centerX, y: centerY + halfHeight, type: 'corner' },     // Bottom
        { x: centerX - halfWidth, y: centerY, type: 'corner' },      // Left
        { x: centerX + halfWidth * 0.5, y: centerY - halfHeight * 0.5, type: 'edge' },
        { x: centerX + halfWidth * 0.5, y: centerY + halfHeight * 0.5, type: 'edge' },
        { x: centerX - halfWidth * 0.5, y: centerY + halfHeight * 0.5, type: 'edge' },
        { x: centerX - halfWidth * 0.5, y: centerY - halfHeight * 0.5, type: 'edge' },
      );
      return handles;
    }
    
    case 'hexagon': {
      const radius = Math.max(width, height) / 2 * 0.9;
      const angles = [0, Math.PI/3, 2*Math.PI/3, Math.PI, 4*Math.PI/3, 5*Math.PI/3];
      
      angles.forEach(angle => {
        handles.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
          type: 'corner'
        });
      });
      return handles;
    }
    
    case 'oval': {
      const a = width / 2 * 0.95;
      const b = height / 2 * 0.85;
      
      handles.push(
        { x: centerX, y: centerY - b, type: 'edge' },        // Top
        { x: centerX + a, y: centerY, type: 'edge' },        // Right
        { x: centerX, y: centerY + b, type: 'edge' },        // Bottom
        { x: centerX - a, y: centerY, type: 'edge' },        // Left
        { x: centerX + a * 0.707, y: centerY - b * 0.707, type: 'corner' },
        { x: centerX + a * 0.707, y: centerY + b * 0.707, type: 'corner' },
        { x: centerX - a * 0.707, y: centerY + b * 0.707, type: 'corner' },
        { x: centerX - a * 0.707, y: centerY - b * 0.707, type: 'corner' },
      );
      return handles;
    }
    
    default: {
      // Default bounding box handles for all other shapes
      const halfWidth = width / 2 * 0.95; 
      const halfHeight = height / 2 * 0.95;
      
      handles.push(
        // Standard 8-point bounding box handles
        // Corners
        { x: centerX - halfWidth, y: centerY - halfHeight, type: 'corner' }, // top-left
        { x: centerX + halfWidth, y: centerY - halfHeight, type: 'corner' }, // top-right
        { x: centerX - halfWidth, y: centerY + halfHeight, type: 'corner' }, // bottom-left
        { x: centerX + halfWidth, y: centerY + halfHeight, type: 'corner' }, // bottom-right
        // Edges
        { x: centerX, y: centerY - halfHeight, type: 'edge' },             // top
        { x: centerX, y: centerY + halfHeight, type: 'edge' },             // bottom
        { x: centerX - halfWidth, y: centerY, type: 'edge' },              // left
        { x: centerX + halfWidth, y: centerY, type: 'edge' },              // right
      );
      return handles;
    }
  }
}
}

// Export shape types for external use
export const SHAPE_TYPES = {
  rectangle: 0,
  circle: 1,
  diamond: 2,
  hexagon: 3,
  package: 4,
  roundedRectangle: 5,
  initialNode: 6,
  finalNode: 7,
  oval: 8,
  actor: 9,
  none: 10
} as const;