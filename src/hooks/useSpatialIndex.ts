import { useRef, useCallback } from 'react';
import type { AABB, DiagramNode,  Point, SpatialNode } from '../utils/SpatialIndex';
import { SpatialIndex, diagramNodeToSpatial  } from '../utils/SpatialIndex'

export interface SpatialDiagramHook {
  addNode: (node: DiagramNode) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (node: DiagramNode) => void;
  getVisibleNodes: (viewport: AABB) => DiagramNode[];
  hitTest: (point: Point) => DiagramNode[];
  clear: () => void;
  rebuild: (nodes: DiagramNode[]) => void;
  getDebugInfo: () => any;
}

export const useSpatialIndex = (initialBounds: AABB): SpatialDiagramHook => {
  const spatialIndexRef = useRef(new SpatialIndex<DiagramNode>(initialBounds));
  
  const addNode = useCallback((node: DiagramNode) => {
    const spatialNode = diagramNodeToSpatial(node);
    spatialIndexRef.current.addItem(node.id, spatialNode.bounds, node);
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    return spatialIndexRef.current.removeItem(nodeId);
  }, []);

  const updateNode = useCallback((node: DiagramNode) => {
    addNode(node);
  }, [addNode]);

  const getVisibleNodes = useCallback((viewport: AABB) => {
    const spatialNodes = spatialIndexRef.current.queryRegion(viewport);
    return spatialNodes.map((sn: SpatialNode) => sn.data);
  }, []);

  const hitTest = useCallback((point: Point) => {
    const spatialNodes = spatialIndexRef.current.hitTest(point);
    // Smallest first, so a node on top of a larger one wins the tap
    return spatialNodes
      .map((sn: SpatialNode) => sn.data)
      .sort((a: DiagramNode, b: DiagramNode) => {
        const aSize = a.visual?.size || a.data.size || { width: 100, height: 60 };
        const bSize = b.visual?.size || b.data.size || { width: 100, height: 60 };
        return (aSize.width * aSize.height) - (bSize.width * bSize.height);
      });
  }, []);

  const clear = useCallback(() => {
    spatialIndexRef.current.clear();
  }, []);

  const rebuild = useCallback((nodes: DiagramNode[]) => {
    spatialIndexRef.current.clear();
    nodes.forEach(node => addNode(node));
  }, [addNode]);

  const getDebugInfo = useCallback(() => {
    return spatialIndexRef.current.getDebugInfo();
  }, []);

  return {
    addNode,
    removeNode,
    updateNode,
    getVisibleNodes,
    hitTest,
    clear,
    rebuild,
    getDebugInfo,
  };
};

