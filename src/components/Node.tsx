import React, { useEffect, useRef } from 'react';
import { useDiagram } from '../context/DiagramContext';
import type { NodeSchema } from '../types';

// Node component
interface NodeProps {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: any;
  visual?: NodeSchema['visual'];
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
      const node: NodeSchema = {
        id,
        type,
        visual: {
          width: 120,
          height: 80,
          color: '#3b82f6',
          shape: 'rectangle' as const,
          ...visual
        },
        data: {
          ...data,
          position
        }
      };

      console.log('Adding node:', node);
      addNode(node);
      hasAddedRef.current = true;
    }
  }, []); // Empty dependency array - only run once

  return null;
};