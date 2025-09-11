import React from 'react';

export interface NodeType {
  id: string;
  name: string;
  shape: 'rectangle' | 'circle' | 'diamond' | 'package' | 'roundedRectangle' | 'hexagon' | 'initialNode' | 'finalNode' | 'oval' | 'actor';
  color: string;
  width: number;
  height: number;
  icon?: string;
}

const nodeTypes: NodeType[] = [
  {
    id: 'process',
    name: 'Process',
    shape: 'rectangle',
    color: '#3b82f6',
    width: 120,
    height: 60,
    icon: '⚙️'
  },
  {
    id: 'decision',
    name: 'Decision',
    shape: 'diamond',
    color: '#f59e0b',
    width: 100,
    height: 80,
    icon: '❓'
  },
  {
    id: 'database',
    name: 'Database',
    shape: 'circle',
    color: '#10b981',
    width: 100,
    height: 100,
    icon: '🗄️'
  },
  {
    id: 'start',
    name: 'Start',
    shape: 'initialNode',
    color: '#22c55e',
    width: 60,
    height: 60,
    icon: '▶️'
  },
  {
    id: 'end',
    name: 'End',
    shape: 'finalNode',
    color: '#ef4444',
    width: 60,
    height: 60,
    icon: '⏹️'
  },
  {
    id: 'actor',
    name: 'Actor',
    shape: 'actor',
    color: '#8b5cf6',
    width: 80,
    height: 100,
    icon: '👤'
  },
  {
    id: 'package',
    name: 'Package',
    shape: 'package',
    color: '#06b6d4',
    width: 120,
    height: 80,
    icon: '📦'
  }
];

interface NodePaletteProps {
  onNodeDragStart: (nodeType: NodeType, event: React.DragEvent) => void;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ onNodeDragStart }) => {
  const handleDragStart = (nodeType: NodeType) => (event: React.DragEvent) => {
    event.dataTransfer.setData('application/node-type', JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = 'copy';
    
    const dragElement = event.currentTarget as HTMLElement;
    const rect = dragElement.getBoundingClientRect();
    event.dataTransfer.setDragImage(dragElement, rect.width / 2, rect.height / 2);
    
    onNodeDragStart(nodeType, event);
  };

  return (
    <div style={{
      width: '200px',
      backgroundColor: '#f8f9fa',
      border: '1px solid #e9ecef',
      borderRadius: '8px',
      padding: '16px',
      marginRight: '20px'
    }}>
      <h3 style={{ 
        margin: '0 0 16px 0', 
        fontSize: '16px', 
        fontWeight: 'bold',
        color: '#495057'
      }}>
        Node Palette
      </h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {nodeTypes.map((nodeType) => (
          <div
            key={nodeType.id}
            draggable
            onDragStart={handleDragStart(nodeType)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              backgroundColor: '#ffffff',
              border: '1px solid #dee2e6',
              borderRadius: '6px',
              cursor: 'grab',
              userSelect: 'none',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f8f9fa';
              e.currentTarget.style.borderColor = nodeType.color;
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#dee2e6';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.cursor = 'grabbing';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.cursor = 'grab';
            }}
          >
            <div style={{
              width: '24px',
              height: '24px',
              backgroundColor: nodeType.color,
              borderRadius: nodeType.shape === 'circle' ? '50%' : 
                           nodeType.shape === 'diamond' ? '0' : '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              transform: nodeType.shape === 'diamond' ? 'rotate(45deg)' : 'none'
            }}>
              {nodeType.shape === 'diamond' ? (
                <span style={{ transform: 'rotate(-45deg)' }}>{nodeType.icon}</span>
              ) : (
                nodeType.icon
              )}
            </div>
            
            <div>
              <div style={{ 
                fontWeight: '500', 
                fontSize: '14px',
                color: '#212529'
              }}>
                {nodeType.name}
              </div>
              <div style={{ 
                fontSize: '12px', 
                color: '#6c757d',
                textTransform: 'capitalize'
              }}>
                {nodeType.shape.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div style={{
        marginTop: '16px',
        padding: '12px',
        backgroundColor: '#e3f2fd',
        borderRadius: '4px',
        fontSize: '12px',
        color: '#1565c0'
      }}>
        💡 Tip: Drag nodes onto the canvas to add them to your diagram
      </div>
    </div>
  );
};