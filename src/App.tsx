
import React, { useState, useEffect, useCallback, useRef} from 'react';
import { DiagramCanvas } from './index';
import { type NodeType } from './components/NodePalette';
import "allotment/dist/style.css";
import '@mantine/core/styles.css'
import './App.css';
import { VisualContentNodesTest } from './components/VisualContentNodesTest';
import { ActionIcon, Center, Checkbox, NativeSelect } from '@mantine/core';
import {Dismiss16Regular, Settings16Regular} from '@fluentui/react-icons';
import { useDiagram } from './components/DiagramProvider';
import PropertyEditorPanel from './components/PropertyEditorPanel';
import { Allotment } from 'allotment';
import "allotment/dist/style.css";

// Mobile detection utility
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
      width: window.innerWidth - 500,
      height: window.innerHeight - 300
    };
  }
};

export const DiagramDemo: React.FC = () => {
  const [isMobile, setIsMobile] = useState(isMobileDevice());
  const [canvasSize, setCanvasSize] = useState(getOptimalCanvasSize());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [supportedSampleCount, setSupportedSampleCount] = useState<string[] | undefined>(['1']);
  const internalResolutionRef = useRef({ width: 1920, height: 1080 });
  const [internalResolution, setInternalResolution] = useState({ 
    width: 1920, 
    height: 1080 
  });

  const changeResolution = (newRes: { width: number; height: number }) => {
    console.log(internalResolution);
    internalResolutionRef.current = newRes; 
    setInternalResolution(newRes);            
  };

  const {handleSampleCountChange, fxaaEnabled, smaaEnabled, setFXAAEnabled, setSMAAEnabled, sampleCount} = useDiagram();
  




  // Mobile viewport setup
  useEffect(() => {
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
  }, [isMobile]);

    useEffect(() => {
    const handleResize = () => {
      const mobile = isMobileDevice();
      setIsMobile(mobile);
      setCanvasSize(getOptimalCanvasSize());
      
    };
    handleResize(); // Initial check

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNodeDropped = (nodeType: NodeType, position: { x: number; y: number }) => {
    console.log(`Dropped ${nodeType.name} at position:`, position);
    
    // Provide haptic feedback on mobile
    if (isMobile && navigator.vibrate) {
      navigator.vibrate(100);
    }
  };

  const handleOpenSettingsMenu = useCallback(() => {
     setSettingsOpen(!settingsOpen);
  }, [settingsOpen, setSettingsOpen])

  return (
    <div style={{ width: '100vw', height: '100vh'}}>
      <Allotment defaultSizes={[80, 20]}>

        {/* Main Canvas Area */}
        <div style={{display: 'relative', height: '100vh'}}>      

          {/* Canvas Container */}

          <Center style={{position: 'relative'}} h='100vh'>
            <div style={{top: '-215px', left: `${window.innerWidth-515}px`, display: 'block', position: 'relative', zIndex: 10}}><ActionIcon variant='subtle' onClick={handleOpenSettingsMenu}><Settings16Regular/></ActionIcon></div>



            <DiagramCanvas 
              width={canvasSize.width}
              height={canvasSize.height}
              setSupportedSampleCount={setSupportedSampleCount}
              onNodeDropped={handleNodeDropped}
              internalResolutionRef={internalResolutionRef}
              showDebugInfo
            />

            <VisualContentNodesTest />
          </Center>

          {/* Mobile Instructions */}
          {isMobile && (
            <div style={{
              padding: '12px 16px',
              backgroundColor: '#404040ff',
              borderTop: '1px solid #555',
              color: '#cccccc',
              fontSize: '12px',
              textAlign: 'center'
            }}>
              <p style={{ margin: '0 0 4px 0' }}>
                Touch to select • Drag to move • Pinch to zoom
              </p>
              <p style={{ margin: 0, opacity: 0.7 }}>
                Tap "Show Palette" to add new nodes
              </p>
            </div>
          )}

          {/* Settings Panel */}
          {settingsOpen && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: isMobile ? '100vw' : 340,
              height: isMobile ? '100vh' : 'auto',
              backgroundColor: '#222',
              zIndex: 200,
              boxShadow: '0 0 16px #000a',
              padding: 10,
              overflowY: 'auto'
            }}>
              <div className="SettingsContentContainer">

                <div style={{ paddingTop: 10, paddingRight: 10, placeSelf: 'end', zIndex: '100' }}><ActionIcon variant='subtle' onClick={handleOpenSettingsMenu}><Dismiss16Regular/></ActionIcon></div>
                {/* ... MSAA section ... */}

            <NativeSelect label='Resolution' data={['1280x720', '1920x1080', '2560x1440', '3840x2160']} value={`${internalResolutionRef.current.width}x${internalResolutionRef.current.height}`} onChange={(e) => {
              const widthHeight = e.currentTarget.value.split('x').map(v => parseInt(v));
              changeResolution({width: widthHeight[0], height: widthHeight[1]});
              console.log('internal resolution selected', e.currentTarget.value)
            }} />
       
            {supportedSampleCount && supportedSampleCount.length > 0 && <NativeSelect label='MSAA' onChange={(e) => {handleSampleCountChange(e.currentTarget.value); console.log('sample count selected', e.currentTarget.value)}} value={sampleCount} data={supportedSampleCount}/>}
      
            
            <div style={{display: 'block'}}><Checkbox label="FXAA" checked={fxaaEnabled} onChange={(e) => setFXAAEnabled(e.currentTarget.checked)}/></div>
            <div style={{display: 'block'}}><Checkbox label="SMAA" checked={smaaEnabled} onChange={(e) => setSMAAEnabled(e.currentTarget.checked)}/></div>

            </div>

                
              
        </div>)}
      </div>
      <div>
      <PropertyEditorPanel />
      </div>
    </Allotment>
    </div>
  );
};