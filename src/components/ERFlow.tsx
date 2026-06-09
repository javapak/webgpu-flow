import { DiagramCanvas } from '../components/DiagramCanvas';
import { Node } from '../components/Node';
import { Edge } from '../components/Edge';
import { type NodeType } from '../components/NodePalette';
import { useEffect, useRef, useState } from 'react';
import type { MarkerType } from '../renderers/FloatingEdgeRenderer';

const raw = await import('../assets/efta_webgpu_flow.json');

const { nodes, edges } =  { nodes: raw.nodes, edges: raw.edges };
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
};


const getOptimalCanvasSize = () => {
  const isMobile = isMobileDevice();
  if (isMobile) {
    return {
      width: Math.max(300, window.innerWidth - 40),
      height: Math.max(400, window.innerHeight - 200)
    };
  } else {
    return {
      width: window.innerWidth - 250,
      height: window.innerHeight - 150
    };
  }
};

  const handleNodeDropped = (nodeType: NodeType, position: { x: number; y: number }) => {
    const isMobile = isMobileDevice();
    console.log(`Dropped ${nodeType.name} at position:`, position);
    
    // Provide haptic feedback on mobile
    if (isMobile && navigator.vibrate) {
      navigator.vibrate(100);
    }
  };

export default function ERFlow() {
    const [, setSupportedSampleCount] = useState<string[] | undefined>(['2']);
    const [canvasSize, setCanvasSize] = useState(() => getOptimalCanvasSize());
    const [, setNodes] = useState<any>();
    const [, setEdges ] = useState<any>();


    
useEffect(() => {
    setNodes(nodes);
    setEdges(edges);
    const isMobile = isMobileDevice();
    if (isMobile) {
      // Set up mobile viewport
      let viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        document.head.appendChild(viewport);
      }
      viewport.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
      );

      // Prevent default touch behaviors
      document.body.style.overscrollBehavior = 'contain';
      document.body.style.touchAction = 'manipulation';
    }

    const handleResize = () => {
      setCanvasSize(getOptimalCanvasSize());
      
    };
    handleResize(); // Initial check

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
}, []);





    const internalResolutionRef = useRef({width: 1920, height: 1080});
    return (
        <div style={{overflow: 'hidden'}}>
            <DiagramCanvas 
                    width={canvasSize.width}
                    height={canvasSize.height}
                    setSupportedSampleCount={setSupportedSampleCount}
                    onNodeDropped={handleNodeDropped}
                    internalResolutionRef={internalResolutionRef}
                    showDebugInfo
                    onNodeClick={() => {}}
                    
                  

            />
          
        {<>{nodes.map((node) => <Node key={node.id} id={node.id} visual={node.visual} type={node.type} position={node.position} data={node.data} /> )} </>}
        {<>{edges.map((edge) => <Edge key={edge.id} id={edge.id} sourceNodeId={edge.sourceNodeId} data={edge.data} targetNodeId={edge.targetNodeId} userVertices={edge.userVertices} style={{ targetMarker: edge.style.targetMarker as MarkerType, labelColor: "#ffffff", thickness: 3, color: [0,0,0,255] ,sourceMarker: edge.style.sourceMarker as MarkerType}} />)}</>}
 
            
        </div>
    );
        
            
        } 
