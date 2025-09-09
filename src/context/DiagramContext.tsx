import React, { createContext, useContext } from 'react';
import { type DiagramContextType } from '../types';

const DiagramContext = createContext<DiagramContextType | null>(null);

export const useDiagram = () => {
  const context = useContext(DiagramContext);
  if (!context) {
    throw new Error('useDiagram must be used within a DiagramProvider');
  }
  return context;
};

export { DiagramContext };