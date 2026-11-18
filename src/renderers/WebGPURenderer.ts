/// <reference types="@webgpu/types" />
import type { DiagramEdge, DiagramNode, Viewport } from '../types';
import { LabelRenderer } from './LabelRenderer';
import { VisualContentRenderer } from './VisualContentRenderer';
import { Z_LAYERS, nodeZ } from '../utils/DepthConstants';
import { ROW_ICON, boxLayout, boxShapeOf, headerIcon, isBoxed, isRow, nestingOf, rowLayout } from '../utils/Nesting';
import { FloatingEdgeRenderer } from './FloatingEdgeRenderer';
import { resizeHandles } from '../utils/NodeGeometry';
import GPUCapabilities from '../utils/GPUCapabilities';
import type { EdgeDrawingState } from '../components/DiagramProvider';
import { GridSnapping } from '../utils/GridSnapping';
import { canShowResizeHandles } from '../utils/CanvasCoords';
import SupersamplingManager from './SupersamplingManager';
import { FXAARenderer } from './FXAARendererer';
import { SMAARenderer } from './SMAARenderer';

interface NodeInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
  isSelected: number; // 0 or 1
  shapeType: number;
  depth: number;      // z, from the node's nesting depth
}

interface HandleInstanceData {
  position: [number, number];
  size: [number, number];
  color: [number, number, number, number];
}

export class WebGPURenderer {
  private context: GPUCanvasContext | null = null;
  private static nodeRenderPipeline: GPURenderPipeline | null = null;
  private static handleRenderPipeline: GPURenderPipeline | null = null;
  private static gridRenderPipeline: GPURenderPipeline | null = null;
  private nodeBuffer: GPUBuffer | null = null;
  private handleBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private gridUniformBuffer: GPUBuffer | null = null;
  /** Spacing of the drawn grid's finest lines, in world units: the snapping grid's. */
  gridSize = GridSnapping.getDefaultGridSize();
  private nodeBindGroup: GPUBindGroup | null = null;
  private handleBindGroup: GPUBindGroup | null = null;
  private gridBindGroup: GPUBindGroup | null = null;
  private static device: GPUDevice | null = null;
  public initialized = false;
  private canvas: HTMLCanvasElement | null = null;
  private labelRenderer: LabelRenderer | null = null;
  private visualRenderer: VisualContentRenderer | null = null;
  private _depthTexture: GPUTexture | null = null;
  private multisampledTexture: GPUTexture | null = null;
  private edgeRenderer: FloatingEdgeRenderer | null = null;
  private _gpuCapibilitiesRef: GPUCapabilities | null = null;
  private sampleCount: string = '1';
  private _isReconfiguring: boolean = false;
  private _isResizing: boolean = false;
  private _renderInProgress: boolean = false;
  private _supersamplingManager: SupersamplingManager | null = null;
  private fxaaRenderer: FXAARenderer | null = null;
  private smaaRenderer: SMAARenderer | null = null;
  private fxaaEnabled: boolean = false;
  private smaaEnabled: boolean = false;
  private intermediateTexture: GPUTexture | null = null; 
  private intermediateTexture2: GPUTexture | null = null;
  private _isBusy: boolean = false;
  private _rafHandle: number | null = null;
  onResizeComplete: (() => void) | null = null;







  get isReconfiguring() {
    return this._isReconfiguring;
  }

  get gpuCapibilitiesRef() {
    return this._gpuCapibilitiesRef;
  }

  get supersamplingManager() {
    return this._supersamplingManager;
  }

  getDeviceRef() {
    return WebGPURenderer.device;
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

  set isBusy(val: boolean) {
    this._isBusy = val;
  }

  set rafHandle(val: number) {
    this._rafHandle = val;
  }
  

  attachCanvas(canvas: HTMLCanvasElement) {
  this.canvas = canvas;
  this.context = canvas.getContext('webgpu');
  
  this.context?.configure({
    device: WebGPURenderer.device!,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'premultiplied',
  });
  this.recreateSizeDependentTextures(canvas.width, canvas.height);

}

private recreateSizeDependentTextures(width: number, height: number) {
  const sampleCountNum = parseInt(this.sampleCount);
  
  // Recreate depth texture
  this._depthTexture?.destroy();
  this._depthTexture = WebGPURenderer.device!.createTexture({
    size: [width, height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    sampleCount: sampleCountNum
  });

  // Recreate MSAA texture if needed
  if (sampleCountNum > 1) {
    this.multisampledTexture?.destroy();
    this.multisampledTexture = WebGPURenderer.device!.createTexture({
      size: [width, height],
      format: navigator.gpu.getPreferredCanvasFormat(),
      sampleCount: sampleCountNum,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
}


  async initialize(): Promise<boolean> {
    try {
      if (!navigator.gpu) {
        console.warn('WebGPU not supported in this browser');
        return false;
      }
      
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          console.warn('No WebGPU adapter available');
          return false;
        }
        WebGPURenderer.device = await adapter.requestDevice();
      } catch (error) {
        console.error('Failed to acquire a WebGPU device:', error);
        return false;
      }
      
      // Check MSAA support
      try {
        this._gpuCapibilitiesRef = new GPUCapabilities(WebGPURenderer.device!);
        const msaaSupport = await this._gpuCapibilitiesRef.checkMSAASupport();
        
        // Ensure we start with a supported sample count
        if (!msaaSupport.supportedCounts.includes(this.sampleCount)) {
          console.warn(`Initial sample count ${this.sampleCount} not supported, using 1`);
          this.sampleCount = '1';
        }
      } catch (error) {
        console.error('Failed to check MSAA support:', error);
        this.sampleCount = '1'; // Fallback to no MSAA
      }
      

      // Setup render pipelines
      try {
        await this.setupRenderPipelines();
      } catch (error) {
        console.error('Failed to setup render pipelines:', error);
        return false;
      }

      this.initialized = true;

      // Initialize label renderer
      try {
        this.labelRenderer = new LabelRenderer(WebGPURenderer.device!, this.uniformBuffer!, this.sampleCount);
        await this.labelRenderer.initialize();
      } catch (error) {
        console.error('Failed to initialize label renderer:', error);
        // Non-fatal - continue without labels
      }


      // Initialize visual renderer
      try {
        this.visualRenderer = new VisualContentRenderer(WebGPURenderer.device!, this.uniformBuffer!, this.sampleCount);
        await this.visualRenderer.initialize();

      } catch (error) {
        console.error('Failed to initialize visual renderer:', error);
        // Non-fatal - continue without visual content
      }

      try {
        this._supersamplingManager = new SupersamplingManager(WebGPURenderer.device!, this.sampleCount);
      }
      catch (error) {
        console.warn('Supersampling unavailable:', error);
      }


      try {
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.fxaaRenderer = new FXAARenderer(WebGPURenderer.device!, canvasFormat);
      }
      catch (e) {
        console.error('Failed to create FXAA renderer:', e);
      }

      try {
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.smaaRenderer = new SMAARenderer(WebGPURenderer.device!, canvasFormat);
      } catch (e) { 
        console.error('Failed to create SMAA renderer:', e);
      }
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

  /**
   * Resizes the render target. Waits out any in-flight frame first, because the
   * resize path refuses to run while the renderer is busy.
   */
  async setResolution(size: { width: number; height: number }): Promise<void> {
    for (let i = 0; i < 120 && this.isBusy; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await this.updateDepthTextureOnSizeChange(size);

    // Supersampled targets are sized from the canvas too.
    const manager = this.supersamplingManager;
    if (manager && manager.getSupersamplingFactor() > 1) {
      manager.createSupersampledTextures(size.width, size.height, parseInt(this.sampleCount), navigator.gpu.getPreferredCanvasFormat());
    }
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
  if (this.intermediateTexture2) {
    this.intermediateTexture2.destroy();
  }

  const textureDescriptor = {
    size: { width, height },
    format: navigator.gpu.getPreferredCanvasFormat(),
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    label: 'intermediate-texture-for-aa'
  };

  this.intermediateTexture = WebGPURenderer.device!.createTexture(textureDescriptor);
  
  // Second texture for ping-pong when both SMAA and FXAA are enabled
  this.intermediateTexture2 = WebGPURenderer.device!.createTexture({
    ...textureDescriptor,
    label: 'intermediate-texture-2-for-aa'
  });
}

  async initializeLabelRenderer() {
    return await this.labelRenderer?.initialize();
  }

  async initializeFloatingEdgeRenderer() {
    this.edgeRenderer = new FloatingEdgeRenderer(
          WebGPURenderer.device!,
          navigator.gpu.getPreferredCanvasFormat(),
          20,
          1000,
          this.sampleCount)
  }




  setFXAAEnabled(enabled: boolean) {
    this.fxaaEnabled = enabled;
  }

  setSMAAEnabled(enabled: boolean) {
    this.smaaEnabled = enabled;
  }


  async setSampleCount(count: string) {
    if (!this._gpuCapibilitiesRef?.sampleCountsSupported?.includes(count)) {
      console.warn(`Sample count ${count} not supported`);
      return;
    }

    if (this.sampleCount === count) {
      return;
    } 
    
    
    // Set first so render() and resize() bail out while targets are rebuilt.
    this._isReconfiguring = true;
    
    // Wait a frame to ensure any in-flight renders complete
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    if (this.canvas && WebGPURenderer.device) {
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
        await WebGPURenderer.device?.queue.onSubmittedWorkDone();
        
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
        
        // Update sample count
        this.sampleCount = count;
        
        // Create new textures
        this._depthTexture = WebGPURenderer.device!.createTexture({
          label: `depth-texture-msaa-${count}`,
          size: [this.canvas.width, this.canvas.height],
          format: 'depth24plus',
          sampleCount: sampleCountNum,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        
        
        if (sampleCountNum > 1) {
          this.multisampledTexture = WebGPURenderer.device!.createTexture({
            label: `multisampled-color-${count}`,
            size: [this.canvas.width, this.canvas.height],
            format: navigator.gpu.getPreferredCanvasFormat(),
            sampleCount: sampleCountNum,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
        }
        
        // Recreate pipelines
        await this.setupRenderPipelines();
        

        // Recreate renderers
        this.labelRenderer = new LabelRenderer(WebGPURenderer.device, this.uniformBuffer!, count);
        await this.labelRenderer.initialize();
        
        this.visualRenderer = new VisualContentRenderer(WebGPURenderer.device, this.uniformBuffer!, count);
        await this.visualRenderer.initialize();

        
        this.edgeRenderer = new FloatingEdgeRenderer(
          WebGPURenderer.device,
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
    if (!WebGPURenderer.device) throw new Error('Device not initialized');

    // Create buffers
    this.uniformBuffer = WebGPURenderer.device.createBuffer({
      size: 80, // mat4x4 (64 bytes) + vec4 (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Grid uniforms also carry the canvas size
    this.gridUniformBuffer = WebGPURenderer.device.createBuffer({
      size: 96, // mat4x4 (64 bytes) + vec4 viewport (16 bytes) + vec4 canvas size, grid size, pixel ratio (16 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.nodeBuffer = WebGPURenderer.device.createBuffer({
      size: 1000 * 64, // Support up to 1000 nodes (16 floats * 4 bytes each = 64 bytes per node)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.handleBuffer = WebGPURenderer.device.createBuffer({
      size: 8 * 32, // Up to 8 handles per selected node (8 floats * 4 bytes each)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    


    // Node shader: each shape is drawn from a signed distance function.
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
        depth: f32,               // z of the node's nesting band
        padding: vec2<f32>,
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
        
        // Shapes fill their box exactly (see NodeGeometry). The quad reaches a little past it, so the
        // antialiased edge has room: a few pixels, or more for small nodes, whose edge blend is wider.
        let margin = max(3.0 / max(uniforms.viewport.z, 0.0001), 0.05 * max(nodeSize.x, nodeSize.y));
        let expand = (nodeSize + 2.0 * margin) / nodeSize;
        localPos.y = -localPos.y;
        let worldPos = node.position + localPos * expand * nodeSize * 0.5;
        
        var output: VertexOutput;
        // Apply view-projection matrix
        output.position = uniforms.viewProjection * vec4<f32>(worldPos.x, worldPos.y, node.depth, 1.0);
        output.color = node.color;
        output.uv = localPos * expand;   // -1..1 across the box, +y down
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
        // Stick figure: head (circle) + body (rectangle)
        let head = sdCircle(p + vec2<f32>(0.0, 0.4), 0.2);
        let body = sdRectangle(p + vec2<f32>(0.0, 0.1), vec2<f32>(0.15, 0.4));
        return min(head, body);
      }

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let uv = input.uv; // -1..1 across the node's box, beyond it in the quad's margin
        let aspectRatio = input.nodeSize.x / input.nodeSize.y;
        
        // For shapes that should maintain aspect ratio, use different coordinates
        let p = vec2<f32>(uv.x * aspectRatio, uv.y);
        let p_square = uv; // For shapes that should ignore aspect ratio
        
        var distance: f32;
        let shapeType = i32(input.shapeType + 0.5); // Round to nearest integer
        
        switch (shapeType) {
          // Every shape fills its box (-1..1 in uv), so what is drawn is what NodeGeometry computes.
          case 0: { // Rectangle
            distance = sdRectangle(p, vec2<f32>(aspectRatio, 1.0));
          }
          case 1: { // Circle (an ellipse in a box that isn't square)
            distance = sdCircle(p_square, 1.0);
          }
          case 2: { // Diamond
            distance = sdDiamond(uv, vec2<f32>(0, 1.0));
          }
          case 3: { // Hexagon: points at the box's left and right, flat at its top and bottom
            distance = max(abs(uv.y) - 1.0, (abs(uv.x) + 0.5 * abs(uv.y) - 1.0) * 0.894427);
          }
          case 4: { // Package: a tab along the top, the body below it
            let mainBody = sdRoundedRectangle(p - vec2<f32>(0.0, 0.1), vec2<f32>(aspectRatio, 0.9), 0.1);
            let tab = sdRectangle(p + vec2<f32>(0.0, 0.9), vec2<f32>(aspectRatio * 0.4, 0.1));
            distance = min(mainBody, tab);
          }
          case 5: { // Rounded Rectangle
            distance = sdRoundedRectangle(p, vec2<f32>(aspectRatio, 1.0), 0.1);
          }
          case 6: { // Initial Node
            distance = sdCircle(p_square, 1.0);
          }
          case 7: { // Final Node (ring)
            let outer = sdCircle(p_square, 1.0);
            let inner = sdCircle(p_square, 0.74);
            distance = max(outer, -inner); // Ring shape
          }
          case 8: { // Oval
            distance = sdOval(p, vec2<f32>(aspectRatio, 1.0));
          }
          case 9: { // Actor
            distance = sdActor(p_square);
          }

        
          case 10: {
            discard;
          }

          default: { // Default to rectangle
            distance = sdRectangle(p, vec2<f32>(aspectRatio, 1.0));
          }
      }

        // Anti-aliasing: widen the edge blend as nodes get smaller on screen
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

    // Grid shader: one quad over the view; each pixel works out its distance to the nearest
    // grid line in screen pixels, so every line is an evenly anti-aliased 1px line wherever it
    // falls. Levels every GRID_STEP cells fade with how close their lines are on screen: minor
    // lines fade out as they crowd together and coarser ones take over, so there is always a
    // readable grid, and nothing pops, since a line's strength depends only on its spacing.
    const gridShaderCode = /* wgsl */`
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        viewport: vec4<f32>, // x, y, zoom, aspect
        canvasSize: vec4<f32>, // width, height, grid size (world units), canvas px per CSS px
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      const GRID_STEP = 5.0;       // cells per line of the next coarser level
      const FADE_FROM_PX = 6.0;    // a level's lines vanish when this close (CSS px)...
      const FULL_FROM_PX = 48.0;   // ...and are fully drawn from this far apart
      const LINE_WIDTH_PX = 1.0;   // CSS px
      const GRID_ALPHA = 0.22;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) world: vec2<f32>,
      }

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        let corners = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
        );
        let ndc = corners[vertexIndex];
        // The view's world rectangle (y grows downwards; ndc y = 1 is the top).
        let halfSize = uniforms.canvasSize.xy / (2.0 * uniforms.viewport.z);
        let world = vec2<f32>(uniforms.viewport.x + ndc.x * halfSize.x, uniforms.viewport.y - ndc.y * halfSize.y);
        var output: VertexOutput;
        output.position = uniforms.viewProjection * vec4<f32>(world, ${Z_LAYERS.BACKGROUND}, 1.0);
        output.world = world;
        return output;
      }

      // How much of this pixel a line of a grid with cells this wide covers (box-filtered).
      fn coverage(world: vec2<f32>, cell: f32, pxPerWorld: f32, widthPx: f32) -> f32 {
        let distancePx = abs(fract(world / cell + 0.5) - 0.5) * cell * pxPerWorld;
        let c = clamp(vec2<f32>(widthPx * 0.5 + 0.5) - distancePx, vec2<f32>(0.0), vec2<f32>(1.0));
        return max(c.x, c.y);
      }

      @fragment
      fn fs_main(@location(0) world: vec2<f32>) -> @location(0) vec4<f32> {
        let pxPerWorld = uniforms.viewport.z;
        let pixelRatio = max(uniforms.canvasSize.w, 1.0);
        let gridSize = uniforms.canvasSize.z;
        let fadeFrom = FADE_FROM_PX * pixelRatio;
        // The finest level whose lines aren't closer than the fade-out spacing.
        let level = max(0.0, ceil(log(fadeFrom / (gridSize * pxPerWorld)) / log(GRID_STEP)));
        var alpha = 0.0;
        // A line on a coarser level is on the finer ones too; it takes its strongest level's strength.
        for (var i = 0.0; i < 3.0; i += 1.0) {
          let cell = gridSize * pow(GRID_STEP, level + i);
          let spacing = cell * pxPerWorld;
          let strength = clamp(log(spacing / fadeFrom) / log(FULL_FROM_PX / FADE_FROM_PX), 0.0, 1.0);
          alpha = max(alpha, coverage(world, cell, pxPerWorld, LINE_WIDTH_PX * pixelRatio) * strength);
        }
        if (alpha < 0.003) {
          discard;
        }
        return vec4<f32>(0.7, 0.7, 0.7, alpha * GRID_ALPHA);
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

    const nodeShaderModule = WebGPURenderer.device.createShaderModule({ code: nodeShaderCode });
    const handleShaderModule = WebGPURenderer.device.createShaderModule({ code: handleShaderCode });
    const gridShaderModule = WebGPURenderer.device.createShaderModule({ code: gridShaderCode });

    // Create bind group layouts
    const bindGroupLayout = WebGPURenderer.device.createBindGroupLayout({
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

    // The grid has its own layout because its uniforms include the canvas size
    const gridBindGroupLayout = WebGPURenderer.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' as const }
        }
      ]
    });

    // Create bind groups
    this.nodeBindGroup = WebGPURenderer.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.nodeBuffer } }
      ]
    });

    this.handleBindGroup = WebGPURenderer.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.handleBuffer } }
      ]
    });

    this.gridBindGroup = WebGPURenderer.device.createBindGroup({
      layout: gridBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.gridUniformBuffer } }
      ]
    });

    // Create render pipelines
    const pipelineLayout = WebGPURenderer.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });

    const gridPipelineLayout = WebGPURenderer.device.createPipelineLayout({
      bindGroupLayouts: [gridBindGroupLayout]
    });

    WebGPURenderer.nodeRenderPipeline = WebGPURenderer.device.createRenderPipeline({
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

    WebGPURenderer.handleRenderPipeline = WebGPURenderer.device.createRenderPipeline({
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

    WebGPURenderer.gridRenderPipeline = WebGPURenderer.device.createRenderPipeline({
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
    if (!WebGPURenderer.device || !this.canvas) {
      return;
    }
    
    if (this._isBusy) {
      return;
    }
    
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      console.warn('Invalid canvas size:', canvasSize);
      return;
    }

    // Drop any queued frame; it would draw with the old targets.
    if (this._rafHandle) {
        cancelAnimationFrame(this._rafHandle);
        this._rafHandle = null;
    }
    this._isResizing = true;

    await WebGPURenderer.device.queue.onSubmittedWorkDone();
    
    try {
      
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
      this._depthTexture = WebGPURenderer.device.createTexture({
        label: `depth-${canvasSize.width}x${canvasSize.height}`,
        size: { width: canvasSize.width, height: canvasSize.height },
        sampleCount: sampleCountNum,
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      
      if (sampleCountNum > 1) {
        this.multisampledTexture = WebGPURenderer.device.createTexture({
          label: `msaa-${canvasSize.width}x${canvasSize.height}`,
          size: { width: canvasSize.width, height: canvasSize.height },
          format: navigator.gpu.getPreferredCanvasFormat(),
          sampleCount: sampleCountNum,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      
      
    } catch (error) {
      console.error('Resize error:', error);
      
      // Simple recovery: recreate with sample count 1
      try {
        if (this.canvas.width === 0) this.canvas.width = canvasSize.width || 800;
        if (this.canvas.height === 0) this.canvas.height = canvasSize.height || 600;
        
        this._depthTexture = WebGPURenderer.device.createTexture({
          label: 'recovery-depth',
          size: { width: this.canvas.width, height: this.canvas.height },
          sampleCount: 1,
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        
        this.multisampledTexture = null;
        this.sampleCount = '1';
        
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError);
        this.initialized = false;
      }
    } finally {
      this._isResizing = false;
      this.onResizeComplete?.();
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
    if (!this.initialized || !WebGPURenderer.device || !this.context || !WebGPURenderer.nodeRenderPipeline) {
      console.warn('WebGPU renderer not properly initialized');
      return;
    }

    if (this._isReconfiguring) {
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
        requestAnimationFrame(() => {
          this.updateDepthTextureOnSizeChange(canvasSize);
        });
        return;
      }

      let canvasTexture: GPUTexture;
      try {
        canvasTexture = this.context.getCurrentTexture();
      } catch (e) {
        return;
      }

      const useFXAA = this.fxaaEnabled;
      const useMSAA = parseInt(this.sampleCount) > 1;
      const useSMAA = this.smaaEnabled;

      // Ensure intermediate texture exists if FXAA is enabled
      if (useFXAA || useSMAA) {
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
      
      if ((useFXAA || useSMAA) && useMSAA) {
        // MSAA + FXAA: Render with MSAA → resolve to intermediate → FXAA → canvas
        colorAttachmentView = this.multisampledTexture!.createView();
        resolveTarget = this.intermediateTexture!.createView();
        
      } else if ((useFXAA || useSMAA) && !useMSAA) {
        // FXAA only: Render → intermediate → FXAA → canvas
        colorAttachmentView = this.intermediateTexture!.createView();
        resolveTarget = undefined;
        
      } else if ((!useFXAA || !useFXAA) && useMSAA) {
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
      WebGPURenderer.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height
        ])
      );

      WebGPURenderer.device.queue.writeBuffer(
        this.gridUniformBuffer!,
        0,
        new Float32Array([
          ...viewProjectionMatrix,
          viewport.x, viewport.y, viewport.zoom, canvasSize.width / canvasSize.height,
          canvasSize.width, canvasSize.height, this.gridSize, viewport.pixelRatio ?? 1
        ])
      );

      // Prepare node instance data
      const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
      // Containers first, so a child's antialiased edge blends over its container, not the grid.
      const nesting = nestingOf(visibleNodes);
      const byDepth = [...visibleNodes].sort((a, b) => nesting.depth(a.id) - nesting.depth(b.id));
      const nodeData: NodeInstanceData[] = byDepth.flatMap((node): NodeInstanceData[] => {
        if (!node.data || !node.data.position) {
          console.warn('Invalid node structure:', node);
          return [];
        }
        
        let color = this.hexToRgba(node.visual?.color || '#3b82f6');
        const size = node.visual?.size || { width: 100, height: 60 };
        const depth = nodeZ(nesting.depth(node.id));
        const isSelected = selectedNodeIds.has(node.id) ? 1 : 0;
        
        if (isRow(node)) {
          // A faint bar in the kind's colour, and the kind's shape as an icon at its left
          // (SVG, image and emoji icons are drawn by the visual renderer instead).
          const bar: NodeInstanceData = {
            position: [node.data.position.x, node.data.position.y],
            size: [size.width, size.height],
            color: [color.r, color.g, color.b, color.a * 0.2],
            shapeType: SHAPE_TYPES.roundedRectangle,
            isSelected,
            depth,
          };
          const shapeType = SHAPE_TYPES[node.visual?.shape as keyof typeof SHAPE_TYPES];
          const drawsVisual = node.visual?.visualContent || node.visual?.icon || node.data?.emoji || node.data?.icon;
          if (shapeType === undefined || node.visual?.shape === 'none' || drawsVisual) return [bar];
          const { icon } = rowLayout(node);
          return [bar, {
            position: [icon.x, icon.y],
            size: [ROW_ICON, ROW_ICON],
            color: [color.r, color.g, color.b, color.a],
            shapeType,
            isSelected: 0,
            depth: depth + 0.001,   // over the bar, under the band's visual content
          }];
        }

        if (isBoxed(node)) {
          // A box in the kind's colour, divided under the header (and between compartment and
          // children); a kind shape that isn't a box is drawn small at the header's left.
          const body: NodeInstanceData = {
            position: [node.data.position.x, node.data.position.y],
            size: [size.width, size.height],
            color: [color.r, color.g, color.b, color.a],
            shapeType: SHAPE_TYPES[boxShapeOf(node.visual?.shape) as keyof typeof SHAPE_TYPES],
            isSelected,
            depth,
          };
          const layout = boxLayout(node);
          const dividers = layout.dividers.map((y): NodeInstanceData => ({
            position: [node.data.position.x, y],
            size: [size.width, 1.5],
            color: [0, 0, 0, 0.25],
            shapeType: SHAPE_TYPES.rectangle,
            isSelected: 0,
            depth: depth + 0.001,
          }));
          if (headerIcon(node) !== 'shape') return [body, ...dividers];
          const ink = this.hexToRgba(node.visual?.labelColor || '#ffffff');
          return [body, ...dividers, {
            position: [layout.icon.x, layout.icon.y],
            size: [ROW_ICON, ROW_ICON],
            color: [ink.r, ink.g, ink.b, ink.a],
            shapeType: SHAPE_TYPES[node.visual!.shape as keyof typeof SHAPE_TYPES] ?? 0,
            isSelected: 0,
            depth: depth + 0.001,
          }];
        }

        let shapeType = SHAPE_TYPES[node.visual?.shape as keyof typeof SHAPE_TYPES] ?? 0;
        if (node.visual?.shape === 'none') {
          color = this.hexToRgba('#00000000');
          shapeType = 10;
        }

        return [{
          position: [node.data.position.x, node.data.position.y],
          size: [size.width, size.height],
          color: [color.r, color.g, color.b, color.a],
          shapeType,
          isSelected,
          depth,
        }];
      });

      const commandEncoder = WebGPURenderer.device.createCommandEncoder();

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
      this.renderGrid(renderPass);

      // Render nodes if we have data
      if (nodeData.length > 0) {
        // Grow the node buffer if needed
        const requiredNodeSize = nodeData.length * 64;
        if (requiredNodeSize > this.nodeBuffer!.size) {
          this.nodeBuffer!.destroy();
          this.nodeBuffer = WebGPURenderer.device.createBuffer({
            size: requiredNodeSize * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          
          this.nodeBindGroup = WebGPURenderer.device.createBindGroup({
            layout: WebGPURenderer.nodeRenderPipeline.getBindGroupLayout(0),
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
          flatNodeData[offset + 10] = node.depth;
          flatNodeData[offset + 11] = 0;
          flatNodeData[offset + 12] = 0;
          flatNodeData[offset + 13] = 0;
          flatNodeData[offset + 14] = 0;
          flatNodeData[offset + 15] = 0;
        });

        WebGPURenderer.device.queue.writeBuffer(this.nodeBuffer!, 0, flatNodeData);

        renderPass.setPipeline(WebGPURenderer.nodeRenderPipeline);
        renderPass.setBindGroup(0, this.nodeBindGroup!);
        renderPass.draw(6, nodeData.length);
      }

      // Resize handles for selected nodes
      const handleData: HandleInstanceData[] = [];
      if (selectedNodes.length > 0) {
        const pixelRatio = viewport.pixelRatio ?? 1;
        const handleSize = Math.max((12 * pixelRatio) / viewport.zoom, 8);

        selectedNodes.forEach(node => {
          if (!node.data || !node.data.position) return;
          
          const size = node.visual?.size || { width: 100, height: 100 };
          if (!canShowResizeHandles(size, viewport.zoom, pixelRatio)) return; // too small on screen to resize; still draggable
          // On the node's outline, where MouseInteractions.getResizeHandle looks for them.
          for (const { handle, x, y } of resizeHandles(node)) {
            const handleColor: [number, number, number, number] = handle.length === 2 ? [1.0, 1.0, 1.0, 1.0] : [0.8, 0.8, 1.0, 1.0];
            handleData.push({ position: [x, y], size: [handleSize, handleSize], color: handleColor });
          }
        });
      }

      if (handleData.length > 0 && WebGPURenderer.handleRenderPipeline) {
        const requiredHandleSize = handleData.length * 32;
        if (requiredHandleSize > this.handleBuffer!.size) {
          this.handleBuffer!.destroy();
          this.handleBuffer = WebGPURenderer.device.createBuffer({
            size: requiredHandleSize * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          
          this.handleBindGroup = WebGPURenderer.device.createBindGroup({
            layout: WebGPURenderer.handleRenderPipeline!.getBindGroupLayout(0),
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

        WebGPURenderer.device.queue.writeBuffer(this.handleBuffer!, 0, flatHandleData);
        
        renderPass.setPipeline(WebGPURenderer.handleRenderPipeline);
        renderPass.setBindGroup(0, this.handleBindGroup!);
        renderPass.draw(6, handleData.length);
      }

      // Edges, then visual content, then labels on top
      try {
        const visualData = await this.visualRenderer?.prepareVisualData(visibleNodes);

        if (this.edgeRenderer) {
          await this.edgeRenderer.render(
            renderPass,
            visibleEdges,
            visibleNodes,
            viewProjectionMatrix,
            previewEdge ? previewEdge : undefined,
            selectedEdges,
            viewport
          );
        }

        if (visualData?.length) {
          this.visualRenderer?.render(renderPass, visualData);
        }

        if (this.labelRenderer) {
          const labelData = this.labelRenderer.prepareLabelData(visibleNodes, visibleEdges, viewport);
          if (labelData.length > 0) {
            this.labelRenderer.render(renderPass, labelData);
          }
        }
      } catch (error) {
        console.error('Error rendering edges, visuals or labels:', error);
      }


      renderPass.end();

      // Apply SMAA or FXAA or both in correct order if enabled.
      if (this.intermediateTexture) {
        if (useSMAA && useFXAA) {
          // Both: SMAA first (better at edges), then FXAA (catches remaining artifacts)
          this.smaaRenderer!.apply(commandEncoder, this.intermediateTexture, this.intermediateTexture2!);
          this.fxaaRenderer!.apply(commandEncoder, this.intermediateTexture2!, canvasTexture);
        } else if (useSMAA) {
          this.smaaRenderer!.apply(commandEncoder, this.intermediateTexture, canvasTexture);
        } else if (useFXAA) {
          this.fxaaRenderer!.apply(commandEncoder, this.intermediateTexture, canvasTexture);
        }
      }


      WebGPURenderer.device.queue.submit([commandEncoder.finish()]);

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

  /** Draws the grid: one quad over the view (see the grid shader). */
  private renderGrid(renderPass: GPURenderPassEncoder) {
    if (!WebGPURenderer.gridRenderPipeline) return;
    renderPass.setPipeline(WebGPURenderer.gridRenderPipeline);
    renderPass.setBindGroup(0, this.gridBindGroup!);
    renderPass.draw(6, 1);
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

      this.context = null;
      WebGPURenderer.nodeRenderPipeline = null;
      WebGPURenderer.handleRenderPipeline = null;
      WebGPURenderer.gridRenderPipeline = null;
      this.nodeBindGroup = null;
      this.handleBindGroup = null;
      this.gridBindGroup = null;
      WebGPURenderer.device = null;
      this.initialized = false;
      this.canvas = null;

    } catch (error) {
      console.error('Error destroying renderer:', error);
    }
  }

}

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

