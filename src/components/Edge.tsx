import React, { useEffect, useRef } from "react";
import { useDiagram } from "../components/DiagramProvider";


// Edge component

export interface EdgeProps{
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  data?: Record<string, unknown>;
  userVertices: Array<{x: number, y: number}>; // User-defined intermediate points
  style: {
    color: [number, number, number, number];
    thickness: number;
    dashPattern?: number[]; // Optional dashing
  };
}

export const Edge: React.FC<EdgeProps> = ({ 
  id, 
  sourceNodeId,
  targetNodeId,
  style,
  userVertices,
  data

}) => {
  const { addEdge } = useDiagram();
  const hasAddedRef = useRef(false);

  useEffect(() => {
    // Only add the edge once
    if (!hasAddedRef.current) {
      const edge: EdgeProps = {
        id,
        sourceNodeId,
        targetNodeId,
        style,
        userVertices,
        data,
        
      };

      addEdge(edge);
      hasAddedRef.current = true;
    }
  }, []); // Empty dependency array - only run once

  return null;
};