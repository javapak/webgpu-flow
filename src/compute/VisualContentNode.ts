import type { VisualContentRenderer } from '../renderers/VisualContentRenderer';
import type { DiagramNode } from '../types';
import type { ShaderBasedEdgeDetector } from './ShaderBasedEdgeDetector';

export class VisualContentNode {
  private node: DiagramNode;
  private edgeCache = new Map<string, {x: number, y: number}>();
  private contentTexture: GPUTexture | null = null;
  private edgeDetector: ShaderBasedEdgeDetector;
  private visualContentRenderer: VisualContentRenderer;
  private lastContentHash: string = '';
  
  constructor(
    node: DiagramNode, 
    edgeDetector: ShaderBasedEdgeDetector,
    visualContentRenderer: VisualContentRenderer
  ) {
    this.node = node;
    this.edgeDetector = edgeDetector;
    this.visualContentRenderer = visualContentRenderer;
  }
  
  // Proxy properties to the underlying DiagramNode
  get id(): string {
    return this.node.id;
  }
  
  get position(): {x: number, y: number} {
    return this.node.data.position;
  }
  
  get size(): {width: number, height: number} {
    return this.node.visual!.size;
  }
  
  get shape(): string {
    return this.node.visual!.shape as string;
  }
  
  get visualContent() {
    return this.node.visual!.visualContent;
  }
  
  get data() {
    return this.node.data;
  }
  
  get visual() {
    return this.node.visual;
  }
  
  // Update the underlying node reference
  updateNode(newNode: DiagramNode) {
    // Clear cache if node content changed
    const newContentHash = this.calculateContentHash(newNode);
    if (newContentHash !== this.lastContentHash) {
      this.invalidateCache();
      this.lastContentHash = newContentHash;
    }
    
    this.node = newNode;
  }
  
  private calculateContentHash(node: DiagramNode): string {
    // Simple hash of visual content properties
    const content = node.visual!.visualContent;
    if (!content) return '';
    
    return JSON.stringify({
      type: content.type,
      content: content.content,
      size: content.size,
      nodeSize: node.visual!.size,
      shape: node.visual!.shape
    });
  }
  
  async getEdgePoint(direction: {x: number, y: number}): Promise<{x: number, y: number}> {
    // For non-visual-content shapes, use geometric calculation
    if (this.node.visual?.shape !== 'none' || !this.node.visual.visualContent) {
      return this.getGeometricEdgePoint(direction);
    }
    
    // For visual content shapes, use shader-based detectionF
    const directionKey = `${direction.x.toFixed(3)},${direction.y.toFixed(3)}`;
    
    if (!this.edgeCache.has(directionKey)) {
      // Ensure we have the content texture
      if (!this.contentTexture) {
        this.contentTexture = await this.renderContentToTexture();
      }
      
      // Detect edge point using shader
      const edgePoint = await this.edgeDetector.detectEdgePoint(
        this.contentTexture,
        this.position,
        direction,
        Math.max(this.size.width, this.size.height) * 0.7
      );
      
      this.edgeCache.set(directionKey, edgePoint);
    }
    
    return this.edgeCache.get(directionKey)!;
  }
  
  private getGeometricEdgePoint(direction: {x: number, y: number}): {x: number, y: number} {
    const length = Math.sqrt(direction.x ** 2 + direction.y ** 2);
    if (length === 0) return this.position;
    
    const normalizedDir = {
      x: direction.x / length,
      y: direction.y / length
    };
    
    // Use the same geometric calculations as EdgeConnectionCalculator
    switch (this.shape) {
      case 'rectangle':
      case 'roundedRectangle':
        return this.rectangleIntersection(normalizedDir);
      case 'circle':
        return this.circleIntersection(normalizedDir);
      case 'oval':
        return this.ellipseIntersection(normalizedDir);
      case 'diamond':
        return this.diamondIntersection(normalizedDir);
      default:
        return this.rectangleIntersection(normalizedDir);
    }
  }
  
  private rectangleIntersection(direction: {x: number, y: number}): {x: number, y: number} {
    const halfWidth = this.size.width / 2;
    const halfHeight = this.size.height / 2;
    
    const tx = direction.x === 0 ? Infinity : (direction.x > 0 ? halfWidth : -halfWidth) / direction.x;
    const ty = direction.y === 0 ? Infinity : (direction.y > 0 ? halfHeight : -halfHeight) / direction.y;
    
    const t = Math.min(Math.abs(tx), Math.abs(ty));
    
    return {
      x: this.position.x + direction.x * t,
      y: this.position.y + direction.y * t
    };
  }
  
  private circleIntersection(direction: {x: number, y: number}): {x: number, y: number} {
    const radius = Math.min(this.size.width, this.size.height) / 2;
    
    return {
      x: this.position.x + direction.x * radius,
      y: this.position.y + direction.y * radius
    };
  }
  
  private ellipseIntersection(direction: {x: number, y: number}): {x: number, y: number} {
    const a = this.size.width / 2;
    const b = this.size.height / 2;
    
    const denominator = (direction.x / a) ** 2 + (direction.y / b) ** 2;
    const t = 1 / Math.sqrt(denominator);
    
    return {
      x: this.position.x + direction.x * t,
      y: this.position.y + direction.y * t
    };
  }
  
  private diamondIntersection(direction: {x: number, y: number}): {x: number, y: number} {
    const halfWidth = this.size.width / 2;
    const halfHeight = this.size.height / 2;
    
    const absX = Math.abs(direction.x);
    const absY = Math.abs(direction.y);
    const t = 1 / (absX / halfWidth + absY / halfHeight);
    
    return {
      x: this.position.x + direction.x * t,
      y: this.position.y + direction.y * t
    };
  }
  
  private async renderContentToTexture(): Promise<GPUTexture> {

    const atlasTexture = this.visualContentRenderer.atlas.getTexture();
    
    if (!atlasTexture) {
      throw new Error('Visual content atlas texture not available');
    }
    

    const device = this.visualContentRenderer.Device;
    const nodeRegion = this.getNodeAtlasRegion(); // You'd need to implement this
    
    if (!nodeRegion) {
      throw new Error(`No atlas region found for node ${this.id}`);
    }
    
    const extractedTexture = device.createTexture({
      size: { width: nodeRegion.width, height: nodeRegion.height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: `extracted-content-${this.id}`
    });
    
    // Copy the node's region from atlas to dedicated texture
    await this.copyAtlasRegionToTexture(atlasTexture, nodeRegion, extractedTexture);
    
    return extractedTexture;
  }
  
  private getNodeAtlasRegion(): {x: number, y: number, width: number, height: number} | undefined {
    // Get the UV coordinates and dimensions for this node's visual content in the atlas
    return this.visualContentRenderer.atlas.getEntry(this.node.visual!.cacheKey);
  }
  
  private async copyAtlasRegionToTexture(
    sourceAtlas: GPUTexture,
    region: {x: number, y: number, width: number, height: number},
    targetTexture: GPUTexture
  ): Promise<void> {
    const device = this.visualContentRenderer.Device;
    const commandEncoder = device.createCommandEncoder();
    
    // Copy the specific region from atlas to target texture
    commandEncoder.copyTextureToTexture(
      {
        texture: sourceAtlas,
        origin: { x: region.x, y: region.y, z: 0 }
      },
      {
        texture: targetTexture,
        origin: { x: 0, y: 0, z: 0 }
      },
      {
        width: region.width,
        height: region.height,
        depthOrArrayLayers: 1
      }
    );
    
    device.queue.submit([commandEncoder.finish()]);
  }
  
  invalidateCache() {
    this.edgeCache.clear();
    if (this.contentTexture) {
      this.contentTexture.destroy();
      this.contentTexture = null;
    }
  }
  
  // Check if the edge cache should be invalidated due to node changes
  shouldInvalidateCache(newNode: DiagramNode): boolean {
    return (
      this.node.data.position.x !== newNode.data.position.x ||
      this.node.data.position.y !== newNode.data.position.y ||
      this.node.visual!.size.width !== newNode.visual?.size.width ||
      this.node.visual!.size.height !== newNode.visual?.size.height ||
      this.node.visual!.shape !== newNode.visual?.shape ||
      JSON.stringify(this.node.visual!.visualContent) !== JSON.stringify(newNode.visual?.visualContent)
    );
  }
  
  destroy() {
    this.invalidateCache();
  }
  
  // Static factory method to create from DiagramNode
  static create(
    node: DiagramNode, 
    edgeDetector: ShaderBasedEdgeDetector,
    visualContentRenderer: VisualContentRenderer
  ): VisualContentNode {
    return new VisualContentNode(node, edgeDetector, visualContentRenderer);
  }
  
  // Batch creation for multiple nodes
  static createMany(
    nodes: DiagramNode[], 
    edgeDetector: ShaderBasedEdgeDetector,
    visualContentRenderer: VisualContentRenderer
  ): Map<string, VisualContentNode> {
    const visualNodes = new Map<string, VisualContentNode>();
    
    for (const node of nodes) {
      visualNodes.set(node.id, new VisualContentNode(node, edgeDetector, visualContentRenderer));
    }
    
    return visualNodes;
  }
}

// Helper class to manage collections of VisualContentNodes
export class VisualContentNodeManager {
  private visualNodes = new Map<string, VisualContentNode>();
  private edgeDetector: ShaderBasedEdgeDetector;
  private visualContentRenderer: VisualContentRenderer;
  
  constructor(edgeDetector: ShaderBasedEdgeDetector, renderer: VisualContentRenderer) {
    this.edgeDetector = edgeDetector;
    this.visualContentRenderer = renderer;
    console.log('from VisualConentNodeManager util class constructor: ', this.edgeDetector, this.visualContentRenderer);
  }
  
  updateNodes(nodes: DiagramNode[]) {
    // Remove nodes that no longer exist
    const currentIds = new Set(nodes.map(n => n.id));
    for (const [id, visualNode] of this.visualNodes) {
      if (!currentIds.has(id)) {
        visualNode.destroy();
        this.visualNodes.delete(id);
      }
    }
    
    // Update or create nodes
    for (const node of nodes) {
      const existing = this.visualNodes.get(node.id);
      if (existing) {
        if (existing.shouldInvalidateCache(node)) {
          existing.invalidateCache();
        }
        existing.updateNode(node);
      } else {
        this.visualNodes.set(node.id, new VisualContentNode(node, this.edgeDetector, this.visualContentRenderer));
      }
    }
  }
  
  getVisualNode(id: string): VisualContentNode | undefined {
    return this.visualNodes.get(id);
  }
  
  getAllVisualNodes(): VisualContentNode[] {
    return Array.from(this.visualNodes.values());
  }
  
  destroy() {
    for (const visualNode of this.visualNodes.values()) {
      visualNode.destroy();
    }
    this.visualNodes.clear();
  }
}