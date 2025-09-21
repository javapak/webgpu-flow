import { useRef, useCallback, useEffect } from 'react';
import { type SpatialNode, type AABB, type Point } from '../types/spatial-indexing/types';
import { diagramNodeToSpatial, SpatialIndex, type DiagramNode } from '../utils/SpatialIndex';

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
    // This automatically handles remove + re-insert
    addNode(node);
  }, [addNode]);

  const getVisibleNodes = useCallback((viewport: AABB) => {
    const spatialNodes = spatialIndexRef.current.queryRegion(viewport);
    console.log('📊 Spatial query returned:', spatialNodes.length, 'nodes');
    const results = spatialNodes.map((sn: SpatialNode) => sn.data);
    results.forEach((node, i) => {
      console.log(`📦 Result ${i}:`, {
        id: node.id,
        position: node.data.position
      });
    });

    return results;
  }, []);

  const hitTest = useCallback((point: Point) => {
    const spatialNodes = spatialIndexRef.current.hitTest(point);
    // Sort by area (smaller nodes first for better selection)
    return spatialNodes
      .map((sn: SpatialNode) => sn.data)
      .sort((a: SpatialNode, b: SpatialNode) => {
        const aSize = a.data.size || { width: 100, height: 60 };
        const bSize = b.data.size || { width: 100, height: 60 };
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

