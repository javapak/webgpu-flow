// src/utils/GridSnapping.ts
export interface GridSnappingOptions {
  gridSize: number;
  enabled: boolean;
}

export class GridSnapping {
  private static DEFAULT_GRID_SIZE = 50;


  
  /**
   * Snap a single coordinate value to the nearest grid point
   */
  static snapToGrid(value: number, gridSize: number = this.DEFAULT_GRID_SIZE): number {
    return Math.round(value / gridSize) * gridSize;
  }

  /**
   * Snap a point (x, y) to the nearest grid intersection
   */
  static snapPointToGrid(
    point: { x: number; y: number },
    gridSize: number = this.DEFAULT_GRID_SIZE
  ): { x: number; y: number } {
    return {
      x: this.snapToGrid(point.x, gridSize),
      y: this.snapToGrid(point.y, gridSize),
    };
  }

  /**
   * Snap dimensions (width, height) to grid multiples
   */
  static snapSizeToGrid(
    size: { width: number; height: number },
    gridSize: number = this.DEFAULT_GRID_SIZE,
    minWidth: number = 40,
    minHeight: number = 30
  ): { width: number; height: number } {
    const snappedWidth = Math.max(
      minWidth,
      Math.round(size.width / gridSize) * gridSize
    );
    const snappedHeight = Math.max(
      minHeight,
      Math.round(size.height / gridSize) * gridSize
    );

    return {
      width: snappedWidth,
      height: snappedHeight,
    };
  }

  /**
   * Snap node position and size to grid
   */
  static snapNodeToGrid(
    position: { x: number; y: number },
    size: { width: number; height: number },
    gridSize: number = this.DEFAULT_GRID_SIZE,
    minWidth: number = 40,
    minHeight: number = 30
  ): {
    position: { x: number; y: number };
    size: { width: number; height: number };
  } {
    return {
      position: this.snapPointToGrid(position, gridSize),
      size: this.snapSizeToGrid(size, gridSize, minWidth, minHeight),
    };
  }

  /**
   * Calculate snapped resize based on handle type
   * This ensures resizing respects grid snapping
   */
  static snapResize(
    newDimensions: { width: number; height: number; x: number; y: number },
    gridSize: number = this.DEFAULT_GRID_SIZE,
    minWidth: number = 40,
    minHeight: number = 30
  ): { width: number; height: number; x: number; y: number } {
    // Snap the size
    const snappedSize = this.snapSizeToGrid(
      { width: newDimensions.width, height: newDimensions.height },
      gridSize,
      minWidth,
      minHeight
    );

    // Snap the position
    const snappedPosition = this.snapPointToGrid(
      { x: newDimensions.x, y: newDimensions.y },
      gridSize
    );

    return {
      width: snappedSize.width,
      height: snappedSize.height,
      x: snappedPosition.x,
      y: snappedPosition.y,
    };
  }

  /**
   * Get visual feedback for grid snapping (snap lines)
   */
  static getSnapLines(
    position: { x: number; y: number },
    gridSize: number = this.DEFAULT_GRID_SIZE,
    viewport: { x: number; y: number; zoom: number; width: number; height: number }
  ): Array<{ x1: number; y1: number; x2: number; y2: number; type: 'vertical' | 'horizontal' }> {
    const snappedPoint = this.snapPointToGrid(position, gridSize);
    const worldWidth = viewport.width / viewport.zoom;
    const worldHeight = viewport.height / viewport.zoom;
    const left = viewport.x - worldWidth / 2;
    const right = viewport.x + worldWidth / 2;
    const top = viewport.y - worldHeight / 2;
    const bottom = viewport.y + worldHeight / 2;

    return [
      // Vertical snap line
      {
        x1: snappedPoint.x,
        y1: top,
        x2: snappedPoint.x,
        y2: bottom,
        type: 'vertical' as const,
      },
      // Horizontal snap line
      {
        x1: left,
        y1: snappedPoint.y,
        x2: right,
        y2: snappedPoint.y,
        type: 'horizontal' as const,
      },
    ];
  }

  /**
   * Check if a point is close to a grid line (for visual feedback)
   */
  static isNearGridLine(
    value: number,
    gridSize: number = this.DEFAULT_GRID_SIZE,
    threshold: number = 5
  ): boolean {
    const remainder = Math.abs(value % gridSize);
    return remainder < threshold || remainder > gridSize - threshold;
  }

  /**
   * Get the default grid size
   */
  static getDefaultGridSize(): number {
    return this.DEFAULT_GRID_SIZE;
  }

  /**
   * Calculate grid-aligned bounds from center point and size
   */
  static calculateGridAlignedBounds(
    center: { x: number; y: number },
    size: { width: number; height: number },
    gridSize: number = this.DEFAULT_GRID_SIZE
  ): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    center: { x: number; y: number };
  } {
    const snappedCenter = this.snapPointToGrid(center, gridSize);
    const snappedSize = this.snapSizeToGrid(size, gridSize);

    return {
      minX: snappedCenter.x - snappedSize.width / 2,
      minY: snappedCenter.y - snappedSize.height / 2,
      maxX: snappedCenter.x + snappedSize.width / 2,
      maxY: snappedCenter.y + snappedSize.height / 2,
      center: snappedCenter,
    };
  }
}