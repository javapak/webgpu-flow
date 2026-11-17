import { DiagramCanvas } from '../components/DiagramCanvas';
import { useDiagram } from '../components/DiagramProvider';
import { useEffect, useRef, useState } from 'react';
import { useRenderSettings } from '../state/renderSettings';

const raw = await import('../assets/efta_webgpu_flow.json');

// The demo file predates the diagram format and relied on the <Node>/<Edge>
// component defaults; apply the same ones so it looks as it always has.
const demo = {
  nodes: raw.nodes.map(node => ({
    ...node,
    visual: { labelFont: 'Arial', shape: 'diamond', ...node.visual },
  })),
  edges: raw.edges.map(edge => ({
    ...edge,
    style: { ...edge.style, labelColor: '#ffffff', thickness: 3, color: [0, 0, 0, 255] },
  })),
};
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
    const { loadDiagram } = useDiagram();

useEffect(() => {
    const problems = loadDiagram(demo);
    if (problems.length) console.warn('Demo diagram:', problems);

    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
}, [loadDiagram]);





    const resolution = useRenderSettings(s => s.resolution);
    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            {canvasSize.width > 0 && <DiagramCanvas 
                    width={canvasSize.width}
                    height={canvasSize.height}
                    setSupportedSampleCount={setSupportedSampleCount}
                    onNodeDropped={handleNodeDropped}
                    resolution={resolution}
                    onNodeClick={() => {}}
            />}
          
 
            
        </div>
    );
        
            
        } 
