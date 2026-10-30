import { DiagramCanvas } from '../components/DiagramCanvas';
import { Node } from '../components/Node';
import { Edge } from '../components/Edge';
import { useEffect, useRef, useState } from 'react';
import type { MarkerType } from '../renderers/FloatingEdgeRenderer';
import { useRenderSettings } from '../state/renderSettings';

const raw = await import('../assets/efta_webgpu_flow.json');

const { nodes, edges } =  { nodes: raw.nodes, edges: raw.edges };
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
};


  const handleNodeDropped = () => {
    const isMobile = isMobileDevice();
    
    if (isMobile && navigator.vibrate) {
      navigator.vibrate(100);
    }
  };

export default function ERFlow() {
    const [, setSupportedSampleCount] = useState<string[] | undefined>(['2']);
    // The canvas fills whatever pane it's placed in; measure it rather than guessing from the window.
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [, setNodes] = useState<any>();
    const [, setEdges ] = useState<any>();


    
useEffect(() => {
    setNodes(nodes);
    setEdges(edges);

    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
}, []);





    const resolution = useRenderSettings(s => s.resolution);
    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            {canvasSize.width > 0 && <DiagramCanvas 
                    width={canvasSize.width}
                    height={canvasSize.height}
                    setSupportedSampleCount={setSupportedSampleCount}
                    onNodeDropped={handleNodeDropped}
                    resolution={resolution}
                    showDebugInfo
                    onNodeClick={() => {}}
            />}
          
        {<>{nodes.map((node) => <Node key={node.id} id={node.id} visual={node.visual} type={node.type} position={node.position} data={node.data} /> )} </>}
        {<>{edges.map((edge) => <Edge key={edge.id} id={edge.id} sourceNodeId={edge.sourceNodeId} data={edge.data} targetNodeId={edge.targetNodeId} userVertices={edge.userVertices} style={{ targetMarker: edge.style.targetMarker as MarkerType, labelColor: "#ffffff", thickness: 3, color: [0,0,0,255] ,sourceMarker: edge.style.sourceMarker as MarkerType}} />)}</>}
 
            
        </div>
    );
        
            
        } 
