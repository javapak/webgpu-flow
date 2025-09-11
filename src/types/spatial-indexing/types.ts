export interface Point {
  x: number;
  y: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialNode<T = any> {
  id: string;
  bounds: AABB;
  data: T;
}

export interface QuadTreeNode<T = any> {
  bounds: AABB;
  items: SpatialNode<T>[];
  children: QuadTreeNode<T>[] | null;
  depth: number;
  maxItems: number;
  maxDepth: number;
}