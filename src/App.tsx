import React, { memo } from 'react';
import { DiagramProvider, DiagramCanvas, Node, Edge } from './index';

export const DiagramDemo: React.FC = () => {
  return (
    <div style={{ padding: '20px' }}>
      <h2>WebGPU-Flow demo</h2>
      <DiagramProvider>
        <DiagramCanvas width={800} height={600} />
        <Node 
          id="node1" 
          type="database" 
          position={{ x: 100, y: 100 }}
          data={{ tableName: "users" }}
          visual={{ 
            color: "#3b82f6", 
            shape: 'circle',
            width: 120, 
            height: 120, 
          }}
        />
        
        <Node 
          id="node2" 
          type="api" 
          position={{ x: 0, y: 50 }}
          data={{ endpoint: "/api/users" }}
          visual={{ 
            color: "#10b981", 
            width: 140, 
            height: 70 
          }}
        />
        
        <Node 
          id="node3" 
          type="frontend" 
          position={{ x: 200, y: 300 }}
          data={{ component: "UserList", label: "Test" }}
          visual={{ 
            color: "#ff42c6", 
            shape: 'hexagon',

            width: 100, 
            height: 90 
          }}
        />
        
        <Edge 
          id="edge1" 
          source="node1" 
          target="node2"
          visual={{ color: "#6b7280", width: 2 }}
        />
        
        <Edge 
          id="edge2" 
          source="node2" 
          target="node3"
          visual={{ color: "#ef4444", width: 3 }}
        />
      </DiagramProvider>
      
      <div style={{ marginTop: '20px', fontSize: '14px', color: '#525252ff' }}>

      </div>
    </div>
  );
};