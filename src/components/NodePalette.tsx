import React from 'react';
import VisualPropertyEditor from './VisualPropertyEditor';
import { DiagramProvider } from './DiagramProvider';

export interface NodeType {
  id: string;
  name: string;
  shape: 'rectangle' | 'circle' | 'diamond' | 'package' | 'roundedRectangle' | 'hexagon' | 'initialNode' | 'finalNode' | 'oval' | 'actor';
  color: string;
  width: number;
  height: number;
  icon?: string;
}

interface NodePaletteProps {
  onNodeDragStart: (nodeType: NodeType, event: React.DragEvent) => void;
  isMobile?: boolean;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ 
  onNodeDragStart, 
  isMobile = false 
}) => {
  // Detect mobile if not explicitly provided
  const isMobileDevice = isMobile || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

  const nodeTypes: NodeType[] = [
    {
      id: 'process',
      name: 'Process',
      shape: 'rectangle',
      color: '#3b82f6',
      width: isMobileDevice ? 100 : 120,
      height: isMobileDevice ? 50 : 60,
      icon: '⚙️'
    },
    {
      id: 'decision',
      name: 'Decision',
      shape: 'diamond',
      color: '#f59e0b',
      width: isMobileDevice ? 80 : 100,
      height: isMobileDevice ? 60 : 80,
      icon: '❓'
    },
    {
      id: 'database',
      name: 'Database',
      shape: 'circle',
      color: '#10b981',
      width: isMobileDevice ? 80 : 100,
      height: isMobileDevice ? 80 : 100,
      icon: '🗄️'
    },
    {
      id: 'start',
      name: 'Start',
      shape: 'initialNode',
      color: '#22c55e',
      width: isMobileDevice ? 50 : 60,
      height: isMobileDevice ? 50 : 60,
      icon: '▶️'
    },
    {
      id: 'end',
      name: 'End',
      shape: 'finalNode',
      color: '#ef4444',
      width: isMobileDevice ? 50 : 60,
      height: isMobileDevice ? 50 : 60,
      icon: '⏹️'
    },
    {
      id: 'actor',
      name: 'Actor',
      shape: 'actor',
      color: '#8b5cf6',
      width: isMobileDevice ? 60 : 80,
      height: isMobileDevice ? 80 : 100,
      icon: '👤'
    },
    {
      id: 'package',
      name: 'Package',
      shape: 'package',
      color: '#06b6d4',
      width: isMobileDevice ? 100 : 120,
      height: isMobileDevice ? 60 : 80,
      icon: '📦'
    }
  ];

  const handleDragStart = (nodeType: NodeType) => (event: React.DragEvent) => {
    event.dataTransfer.setData('application/node-type', JSON.stringify(nodeType));
    event.dataTransfer.effectAllowed = 'copy';
    
    const dragElement = event.currentTarget as HTMLElement;
    const rect = dragElement.getBoundingClientRect();
    event.dataTransfer.setDragImage(dragElement, rect.width / 2, rect.height / 2);
    
    onNodeDragStart(nodeType, event);
  };

  const handleTouchStart = (nodeType: NodeType) => (event: React.TouchEvent) => {
    event.preventDefault();
    if (isMobileDevice) {
      // Provide haptic feedback on mobile
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      // For mobile, we might want to show a different interaction
      // Could implement a tap-to-select, then tap-on-canvas-to-place workflow
      console.log('Mobile node selected:', nodeType.name);
      
      // You could add additional mobile-specific logic here
      // For example, highlighting the selected node or showing instructions
    }
  };

  return (
    <DiagramProvider>
    <div style={{
      width: isMobileDevice ? '100%' : '200px',
      backgroundColor: isMobileDevice ? 'transparent' : '#f8f9fa',
      border: isMobileDevice ? 'none' : '1px solid #e9ecef',
      borderRadius: isMobileDevice ? 0 : '8px',
      padding: isMobileDevice ? '12px 16px' : '16px',
      marginRight: isMobileDevice ? 0 : '20px'
    }}>
      <h3 style={{ 
        margin: '0 0 16px 0', 
        fontSize: isMobileDevice ? '14px' : '16px', 
        fontWeight: 'bold',
        color: isMobileDevice ? '#ffffff' : '#495057'
      }}>
        Node Palette
      </h3>
      
      <div style={{ 
        display: isMobileDevice ? 'flex' : 'flex',
        flexDirection: isMobileDevice ? 'row' : 'column',
        flexWrap: isMobileDevice ? 'wrap' : 'nowrap',
        gap: isMobileDevice ? '8px' : '8px',
        overflowX: isMobileDevice ? 'auto' : 'visible',
        // Add scroll behavior for mobile
        ...(isMobileDevice && {
          WebkitOverflowScrolling: 'touch',
          scrollBehavior: 'smooth',
          overscrollBehavior: 'contain'
        })
      }}>
        {nodeTypes.map((nodeType) => (
          <div
            key={nodeType.id}
            draggable={!isMobileDevice} // Disable drag on mobile to prevent conflicts
            onDragStart={!isMobileDevice ? handleDragStart(nodeType) : undefined}
            onTouchStart={handleTouchStart(nodeType)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobileDevice ? '6px' : '8px',
              padding: isMobileDevice ? '8px 12px' : '12px',
              backgroundColor: isMobileDevice ? '#555555' : '#ffffff',
              border: `1px solid ${isMobileDevice ? '#777777' : '#dee2e6'}`,
              borderRadius: '6px',
              cursor: 'grab',
              userSelect: 'none',
              transition: 'all 0.2s ease',
              minHeight: isMobileDevice ? '44px' : 'auto', // Apple's recommended touch target size
              minWidth: isMobileDevice ? 'auto' : '100%',
              flex: isMobileDevice ? '0 0 auto' : 'none',
              // Mobile-specific touch optimizations
              ...(isMobileDevice && {
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                KhtmlUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent'
              })
            }}
            onMouseEnter={(e) => {
              if (!isMobileDevice) {
                e.currentTarget.style.backgroundColor = '#f8f9fa';
                e.currentTarget.style.borderColor = nodeType.color;
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isMobileDevice) {
                e.currentTarget.style.backgroundColor = '#ffffff';
                e.currentTarget.style.borderColor = '#dee2e6';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
            onMouseDown={(e) => {
              if (!isMobileDevice) {
                e.currentTarget.style.cursor = 'grabbing';
              }
            }}
            onMouseUp={(e) => {
              if (!isMobileDevice) {
                e.currentTarget.style.cursor = 'grab';
              }
            }}
            // Add active state for mobile touch feedback
            onTouchEnd={(e) => {
              if (isMobileDevice) {
                // Brief visual feedback
                const element = e.currentTarget as HTMLElement;
                const originalTransform = element.style.transform;
                element.style.transform = 'scale(0.95)';
                setTimeout(() => {
                  element.style.transform = originalTransform;
                }, 150);
              }
            }}
          >
            <div style={{
              width: isMobileDevice ? '20px' : '24px',
              height: isMobileDevice ? '20px' : '24px',
              backgroundColor: nodeType.color,
              borderRadius: nodeType.shape === 'circle' ? '50%' : 
                           nodeType.shape === 'diamond' ? '0' : '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isMobileDevice ? '10px' : '12px',
              transform: nodeType.shape === 'diamond' ? 'rotate(45deg)' : 'none',
              flexShrink: 0
            }}>
              {nodeType.shape === 'diamond' ? (
                <span style={{ transform: 'rotate(-45deg)' }}>{nodeType.icon}</span>
              ) : (
                nodeType.icon
              )}
            </div>
            
            <div style={{ minWidth: 0 }}>
              <div style={{ 
                fontWeight: '500', 
                fontSize: isMobileDevice ? '12px' : '14px',
                color: isMobileDevice ? '#ffffff' : '#212529',
                whiteSpace: isMobileDevice ? 'nowrap' : 'normal'
              }}>
                {nodeType.name}
              </div>
              {!isMobileDevice && (
                <div style={{ 
                  fontSize: '12px', 
                  color: '#6c757d',
                  textTransform: 'capitalize'
                }}>
                  {nodeType.shape.replace(/([A-Z])/g, ' $1').toLowerCase()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {isMobileDevice && <VisualPropertyEditor/>}
      
      <div style={{
        marginTop: '16px',
        padding: '12px',
        backgroundColor: isMobileDevice ? '#404040ff' : '#e3f2fd',
        borderRadius: '4px',
        fontSize: isMobileDevice ? '11px' : '12px',
        color: isMobileDevice ? '#cccccc' : '#1565c0'
      }}>
        {isMobileDevice ? (
          <>💡 Tip: Tap nodes then tap on canvas to place them</>
        ) : (
          <>💡 Tip: Drag nodes onto the canvas to add them to your diagram</>
        )}
      </div>
    </div>
    </DiagramProvider>
  );
};