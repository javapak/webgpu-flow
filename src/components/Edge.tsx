import React, { useEffect, useMemo, useRef } from "react";
import { useDiagram } from "../components/DiagramProvider";
import type { EdgeSchema } from "../types";


// Edge component
interface EdgeProps {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  visual?: EdgeSchema['visual'];
}

export const Edge: React.FC<EdgeProps> = ({ 
  id, 
  source, 
  target, 
  sourcePort, 
  targetPort, 
  visual = {} 
}) => {
  const { addEdge } = useDiagram();
  const hasAddedRef = useRef(false);

  useEffect(() => {
    // Only add the edge once
    if (!hasAddedRef.current) {
      const edge: EdgeSchema = {
        id,
        source,
        target,
        type: '',
        data: {},
        visual: {
          color: '#6b7280',
          width: 2,
          style: 'solid' as const,
          ...visual
        }
      };

      addEdge(edge);
      hasAddedRef.current = true;
    }
  }, []); // Empty dependency array - only run once

  return null;
};