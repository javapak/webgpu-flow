import React, { memo, useState } from 'react';
import { DiagramProvider, DiagramCanvas, Node, Edge } from './index';
import { NodePalette, type NodeType } from './components/NodePalette';
import { DiagramPerformanceMonitor } from './types';

export const DiagramDemo: React.FC = () => {
  const [draggedNodeType, setDraggedNodeType] = useState<NodeType | null>(null);
  const [nodeCounter, setNodeCounter] = useState(1);

  const handleNodeDragStart = (nodeType: NodeType, event: React.DragEvent) => {
    setDraggedNodeType(nodeType);
    console.log('Started dragging node type:', nodeType.name);
  };

  const handleNodeDropped = (nodeType: NodeType, position: { x: number; y: number }) => {
    console.log(`Dropped ${nodeType.name} at position:`, position);
    setDraggedNodeType(null);
    setNodeCounter(prev => prev + 1);
  };

  return (
    <div style={{ 
      padding: '20px',
      display: 'flex',
      gap: '20px',
      backgroundColor: '#313131ff',
      minHeight: '100vh'
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <NodePalette 
          onNodeDragStart={handleNodeDragStart}
        />
      </div>
      
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '16px' }}>
          <h2 style={{ margin: '0 0 8px 0', color: '#343a40' }}>
            WebGPU Diagram Demo with Drag & Drop
          </h2>
          <p style={{ margin: '0', color: '#6c757d', fontSize: '14px' }}>
            Drag nodes from the palette to add them to the diagram. 
            {draggedNodeType && (
              <span style={{ color: '#007bff', fontWeight: 'bold' }}>
                {' '}Currently dragging: {draggedNodeType.name}
              </span>
            )}
          </p>
        </div>
            
        <div style={{ 
          flex: '1',
          border: '2px dashed #dee2e6',
          borderRadius: '8px',
          padding: '16px',
          backgroundColor: '#262626',
          position: 'relative'
        }}>
          <DiagramProvider >
            <DiagramCanvas 
              width={800} 
              height={600}
              onNodeDropped={handleNodeDropped}
              showDebugInfo
            
            />
            
            {/* Add some example nodes */}
            <Node 
              id="abc" 
              type="database" 
              position={{ x: 100, y: 100 }}
              data={{ 
                tableName: "users",
                label: "Example Database"
              }}
              visual={{ 
                color: "#ff7300ff", 
                shape: 'rectangle',
                size: {
                width: 1000, 
                height: 100,
                }
              }}
            />

           <Node 
              id="example-node1" 
              type="database" 
              position={{ x: 100, y: -100 }}
              data={{ 
                tableName: "users",
                label: "Example Database"
              }}
              visual={{ 
                color: "#004dc8ff", 
                shape: 'rectangle',
                size: {
                width: 100, 
                height: 100,
                }
              }}
            />
            
          <DiagramPerformanceMonitor />

          </DiagramProvider>
        </div>

        <div style={{
          marginTop: '16px',
          display: 'flex',
          gap: '16px',
          fontSize: '14px',
          color: '#313131'
        }}>
          
        </div>
      </div>
    </div>
  );
};