import type { QuadTreeNode, AABB, SpatialNode, Point } from "./types";

export class QuadTree<T = any> {
  private root: QuadTreeNode<T>;
  private readonly MAX_ITEMS = 10;
  private readonly MAX_DEPTH = 8;

  constructor(bounds: AABB, maxItems = 10, maxDepth = 8) {
    this.MAX_ITEMS = maxItems;
    this.MAX_DEPTH = maxDepth;
    this.root = {
      bounds,
      items: [],
      children: null,
      depth: 0,
      maxItems: this.MAX_ITEMS,
      maxDepth: this.MAX_DEPTH,
    };
  }

  // Insert a spatial node into the quadtree
  insert(item: SpatialNode<T>): void {
    this._insertIntoNode(this.root, item);
  }

  private _insertIntoNode(node: QuadTreeNode<T>, item: SpatialNode<T>): void {
    // If item doesn't fit in this node's bounds, don't insert
    if (!this._intersects(node.bounds, item.bounds)) {
      return;
    }

    // If node has no children and is under capacity, add item here
    if (!node.children && node.items.length < node.maxItems) {
      node.items.push(item);
      return;
    }

    // If node has no children but is at capacity, subdivide
    if (!node.children) {
      this._subdivide(node);
      
      // Redistribute existing items to children
      const itemsToRedistribute = [...node.items];
      node.items = [];
      
      for (const existingItem of itemsToRedistribute) {
        this._insertIntoNode(node, existingItem);
      }
    }

    // Insert into appropriate child nodes
    if (node.children) {
      for (const child of node.children) {
        this._insertIntoNode(child, item);
      }
    }
  }

  private _subdivide(node: QuadTreeNode<T>): void {
    if (node.depth >= node.maxDepth) {
      return;
    }

    const { minX, minY, maxX, maxY } = node.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    node.children = [
      // Top-left
      {
        bounds: { minX, minY, maxX: midX, maxY: midY },
        items: [],
        children: null,
        depth: node.depth + 1,
        maxItems: node.maxItems,
        maxDepth: node.maxDepth,
      },
      // Top-right
      {
        bounds: { minX: midX, minY, maxX, maxY: midY },
        items: [],
        children: null,
        depth: node.depth + 1,
        maxItems: node.maxItems,
        maxDepth: node.maxDepth,
      },
      // Bottom-left
      {
        bounds: { minX, minY: midY, maxX: midX, maxY },
        items: [],
        children: null,
        depth: node.depth + 1,
        maxItems: node.maxItems,
        maxDepth: node.maxDepth,
      },
      // Bottom-right
      {
        bounds: { minX: midX, minY: midY, maxX, maxY },
        items: [],
        children: null,
        depth: node.depth + 1,
        maxItems: node.maxItems,
        maxDepth: node.maxDepth,
      },
    ];
  }

  // Query for items intersecting with a region
  query(region: AABB): SpatialNode<T>[] {
    const results: SpatialNode<T>[] = [];
    this._queryNode(this.root, region, results);
    return results;
  }

  private _queryNode(
    node: QuadTreeNode<T>,
    region: AABB,
    results: SpatialNode<T>[]
  ): void {
    // If region doesn't intersect with node bounds, skip
    if (!this._intersects(node.bounds, region)) {
      return;
    }

    // Add intersecting items from this node
    for (const item of node.items) {
      if (this._intersects(item.bounds, region)) {
        results.push(item);
      }
    }

    // Recursively query children
    if (node.children) {
      for (const child of node.children) {
        this._queryNode(child, region, results);
      }
    }
  }

  // Point query for hit testing
  queryPoint(point: Point): SpatialNode<T>[] {
    const results: SpatialNode<T>[] = [];
    this._queryPointNode(this.root, point, results);
    return results;
  }

  private _queryPointNode(
    node: QuadTreeNode<T>,
    point: Point,
    results: SpatialNode<T>[]
  ): void {
    // If point is outside node bounds, skip
    if (!this._containsPoint(node.bounds, point)) {
      return;
    }

    // Check items in this node
    for (const item of node.items) {
      if (this._containsPoint(item.bounds, point)) {
        results.push(item);
      }
    }

    // Recursively query children
    if (node.children) {
      for (const child of node.children) {
        this._queryPointNode(child, point, results);
      }
    }
  }

  // Remove an item from the quadtree
  remove(itemId: string): boolean {
    return this._removeFromNode(this.root, itemId);
  }

  private _removeFromNode(node: QuadTreeNode<T>, itemId: string): boolean {
    // Remove from current node's items
    const initialLength = node.items.length;
    node.items = node.items.filter(item => item.id !== itemId);
    let removed = node.items.length !== initialLength;

    // Remove from children
    if (node.children) {
      for (const child of node.children) {
        if (this._removeFromNode(child, itemId)) {
          removed = true;
        }
      }

      // Check if we can merge children back
      this._tryMerge(node);
    }

    return removed;
  }

  private _tryMerge(node: QuadTreeNode<T>): void {
    if (!node.children) return;

    let totalItems = node.items.length;
    const allItems = [...node.items];

    // Count total items in all children
    for (const child of node.children) {
      totalItems += child.items.length;
      allItems.push(...child.items);
    }

    // If total items is below threshold, merge
    if (totalItems <= node.maxItems) {
      node.items = allItems;
      node.children = null;
    }
  }

  // Clear all items
  clear(): void {
    this.root.items = [];
    this.root.children = null;
  }

  // Update an item (remove and re-insert)
  update(item: SpatialNode<T>): void {
    this.remove(item.id);
    this.insert(item);
  }

  // Rebuild the entire tree (useful after many updates)
  rebuild(items: SpatialNode<T>[]): void {
    this.clear();
    for (const item of items) {
      this.insert(item);
    }
  }

  // Utility methods
  private _intersects(a: AABB, b: AABB): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    );
  }

  private _containsPoint(bounds: AABB, point: Point): boolean {
    return (
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    );
  }

  // Debug method to visualize tree structure
  getDebugInfo(): any {
    return this._getNodeDebugInfo(this.root);
  }

  private _getNodeDebugInfo(node: QuadTreeNode<T>): any {
    return {
      bounds: node.bounds,
      depth: node.depth,
      itemCount: node.items.length,
      itemIds: node.items.map(item => item.id),
      children: node.children ? node.children.map(child => this._getNodeDebugInfo(child)) : null,
    };
  }
}

// spatial/spatialIndex.ts
export class SpatialIndex<T = any> {
  private quadTree: QuadTree<T>;
  private items: Map<string, SpatialNode<T>> = new Map();

  constructor(bounds: AABB, maxItems = 10, maxDepth = 8) {
    this.quadTree = new QuadTree<T>(bounds, maxItems, maxDepth);
  }

  // Add or update an item
  addItem(id: string, bounds: AABB, data: T): void {
    const item: SpatialNode<T> = { id, bounds, data };
    
    // Remove existing item if it exists
    if (this.items.has(id)) {
      this.quadTree.remove(id);
    }
    
    this.items.set(id, item);
    this.quadTree.insert(item);
  }

  // Remove an item
  removeItem(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    this.items.delete(id);
    return this.quadTree.remove(id);
  }

  // Query items in a region
  queryRegion(bounds: AABB): SpatialNode<T>[] {
    return this.quadTree.query(bounds);
  }

  // Hit test at a point
  hitTest(point: Point): SpatialNode<T>[] {
    return this.quadTree.queryPoint(point);
  }

  // Get all items
  getAllItems(): SpatialNode<T>[] {
    return Array.from(this.items.values());
  }

  // Clear all items
  clear(): void {
    this.quadTree.clear();
    this.items.clear();
  }

  // Update bounds (useful for viewport changes)
  updateBounds(bounds: AABB): void {
    const allItems = Array.from(this.items.values());
    this.quadTree = new QuadTree<T>(bounds);
    
    for (const item of allItems) {
      this.quadTree.insert(item);
    }
  }

  // Get debug information
  getDebugInfo() {
    return {
      totalItems: this.items.size,
      quadTreeInfo: this.quadTree.getDebugInfo(),
    };
  }
}