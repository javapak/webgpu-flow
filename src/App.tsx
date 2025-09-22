import React from 'react';
import { DiagramProvider, DiagramCanvas, Node } from './index';
import { NodePalette, type NodeType } from './components/NodePalette';
import { DiagramPerformanceMonitor } from './types';
import { SHAPE_TYPES } from './renderers/WebGPURenderer';

export const DiagramDemo: React.FC = () => {

  const handleNodeDragStart = (nodeType: NodeType, event: React.DragEvent) => {
    console.log('Started dragging node type:', nodeType.name, event);
  };

  const handleNodeDropped = (nodeType: NodeType, position: { x: number; y: number }) => {
    console.log(`Dropped ${nodeType.name} at position:`, position);
  };

  return (
    <div style={{width: '100vw', backgroundColor: '#313131ff',}}>
    <div style={{ 
      padding: '20px',
      display: 'flex',
      backgroundColor: 'inherit',
      gap: '20px',
      minWidth: '50%'
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <NodePalette 
          onNodeDragStart={handleNodeDragStart}
        />
      </div>
      
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '16px' }}>
          <h2 style={{ margin: '0 0 8px 0', color: '#ffffffff' }}>
            WORK IN PROGRESS WEBGPU FLOW DIAGRAM EDITOR
          </h2>
          <p style={{ margin: '0', color: '#ffffffff', fontSize: '14px' }}>
            - shape, resizing interactions, and label support are work in progress
          </p>
        </div>
            
        <div style={{ 
          flex: '1',
          padding: '16px',
          backgroundColor: 'inherit',
          position: 'relative'
        }}>
          <DiagramProvider >
            <DiagramPerformanceMonitor />

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
              position={{ x: 0, y: 200 }}
              data={{ 
                tableName: "users",
                label: "Example Database"
              }}
              visual={{ 
                color: "#ff00bf99", 
                shape: "diamond",
                size: {
                width: 100, 
                height: 100,
                }
              }}
            />

           <Node 
              id="example-node1" 
              type="database" 
              position={{ x: 0, y: 0 }}
              data={{ 
                tableName: "users",
                label: "Example Database"
              }}
              visual={{ 
                color: "#004dc8", 
                shape: 'rectangle',
                size: {
                width: 100, 
                height: 100,
                }
              }}
            />
            
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
    </div>
  );
};