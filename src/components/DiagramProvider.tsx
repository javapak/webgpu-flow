import React, { useState, useRef, type ReactNode, useCallback } from 'react';
import { DiagramContext } from '../context/DiagramContext';
import type { DiagramState, DiagramContextType, NodeSchema, EdgeSchema, InteractionState } from '../types';
import { WebGPUDiagramRenderer } from '../renderers/WebGPURenderer';

interface DiagramProviderProps {
  children: ReactNode;
  initialState?: Partial<DiagramState>;
}

export const DiagramProvider: React.FC<DiagramProviderProps> = ({ 
  children, 
  initialState = {} 
}) => {
  const [state, setState] = useState<DiagramState>({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...initialState
  });

  const rendererRef = useRef<WebGPUDiagramRenderer | null>(null);

  const updateNodes = (nodes: NodeSchema[]) => {
    setState(prev => ({ ...prev, nodes }));
  };

  const updateEdges = (edges: EdgeSchema[]) => {
    setState(prev => ({ ...prev, edges }));
  };

  const setViewport = (viewport: Partial<DiagramState['viewport']>) => {
    setState(prev => ({ 
      ...prev, 
      viewport: { ...prev.viewport, ...viewport } 
    }));
  };

  const addNode = (node: NodeSchema) => {
    setState(prev => ({ 
      ...prev, 
      nodes: [...prev.nodes, node] 
    }));
  };

  const removeNode = (nodeId: string) => {
    setState(prev => ({ 
      ...prev, 
      nodes: prev.nodes.filter(n => n.id !== nodeId),
      edges: prev.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
    }));
  };

  const addEdge = (edge: EdgeSchema) => {
    setState(prev => ({ 
      ...prev, 
      edges: [...prev.edges, edge] 
    }));
  };

  const removeEdge = (edgeId: string) => {
    setState(prev => ({ 
      ...prev, 
      edges: prev.edges.filter(e => e.id !== edgeId)
    }));
  };

  const [interactionState, setInteractionState] = useState<InteractionState>({
  mode: 'idle',
  dragTarget: null,
  lastMousePos: { x: 0, y: 0 },
  selectedNodes: []
});


const setSelectedNodes = useCallback((nodes: NodeSchema[]) => {
  setInteractionState(prev => ({
    ...prev,
    selectedNodes: [...nodes]
  }));
}, []);

const moveNode = useCallback((nodeId: string, position: { x: number; y: number }) => {
  setState(prev => ({
    ...prev,
    nodes: prev.nodes.map(node => 
      node.id === nodeId 
        ? { ...node, data: { ...node.data, position } }
        : node
    )
  }));
}, []);


  const contextValue: DiagramContextType = {
      state,
      renderer: rendererRef.current,
      updateNodes,
      updateEdges,
      setViewport,
      addNode,
      removeNode,
      addEdge,
      removeEdge,
      interactionState,
      setInteractionState,
      setSelectedNodes,
      moveNode,
      }
  

  return (
    <DiagramContext.Provider value={contextValue}>
      {children}
    </DiagramContext.Provider>
  );
}