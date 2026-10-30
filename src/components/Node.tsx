import React, { useEffect, useRef } from 'react';
import type { DiagramNode } from '../types';
import { useDiagram } from './DiagramProvider';
export interface NodeProps {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: any;
  visual?: DiagramNode['visual'];
}

export const Node: React.FC<NodeProps> = ({ 
  id, 
  type, 
  position = { x: 0, y: 0 }, 
  data = {}, 
  visual = {} 
}) => {
  const { addNode } = useDiagram();
  const hasAddedRef = useRef(false);

  useEffect(() => {
    // Only add the node once
    if (!hasAddedRef.current) {
      const node: DiagramNode = {
        id,
        type,
        visual: {
          size: {
          width: 120,
          height: 80},
          color: '#3b82f6',
          labelFont: 'Arial',
          shape: "diamond",
          ...visual
        },
        data: {
          ...data,
          position
        }
      };

      addNode(node as DiagramNode);
      hasAddedRef.current = true;
    }
  }, []);

  return null;
};