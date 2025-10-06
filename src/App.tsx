import React, { useState, useEffect, useCallback} from 'react';
import { DiagramProvider, DiagramCanvas } from './index';
import { NodePalette, type NodeType } from './components/NodePalette';
import '@mantine/core/styles.css'
import './App.css';
import VisualPropertyEditor from './components/VisualPropertyEditor';
import { VisualContentNodesTest } from './components/VisualContentNodesTest';
import { ActionIcon, NativeSelect } from '@mantine/core';
import {Dismiss16Regular, Settings16Regular, Warning16Filled} from '@fluentui/react-icons';


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
  const [paletteVisible, setPaletteVisible] = useState(!isMobileDevice());
  const [canvasSize, setCanvasSize] = useState(getOptimalCanvasSize());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [supportedSampleCount, setSupportedSampleCount] = useState<string[] | undefined>([]);
  const [sampleCount, setSampleCount] = useState('1');
  const [superSamplingValue, setSuperSamplingValue] = useState('Disabled');
  // Handle window resize for responsive design

  useEffect(() => {
    const handleResize = () => {
      const mobile = isMobileDevice();
      setIsMobile(mobile);
      setCanvasSize(getOptimalCanvasSize());
      
      // Auto-hide palette on mobile when resizing
      if (mobile && window.innerWidth < 768) {
        setPaletteVisible(false);
      }
    };



    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


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

  const handleNodeDragStart = (nodeType: NodeType, event: React.DragEvent) => {
    console.log('Started dragging node type:', nodeType.name, event);
  };

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

  const togglePalette = () => {
    setPaletteVisible(!paletteVisible);
  };

  return (
    <DiagramProvider>
      <div style={{ 
        backgroundColor: '#313131ff',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        overflow: 'hidden'
      }}>
        {/* Mobile Header */}
        {isMobile && (
          <div style={{
            padding: '12px 16px',
            backgroundColor: '#404040ff',
            borderBottom: '1px solid #555',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0
          }}>
            <h2 style={{ 
              margin: 0, 
              color: '#ffffff', 
              fontSize: '18px',
              fontWeight: 'bold'
            }}>
              WebGPU Flow Editor
            </h2>
            <button
              onClick={togglePalette}
              style={{
                padding: '8px 16px',
                backgroundColor: paletteVisible ? '#0066cc' : '#777',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                minHeight: '44px',
                minWidth: '44px',
                touchAction: 'manipulation'
              }}
            >
              {paletteVisible ? 'Hide' : 'Show'} Palette
            </button>
          </div>
        )}

        {/* Node Palette - Now with mobile support */}
        {paletteVisible && (
          <div style={{ 
            flex: isMobile ? 'none' : '0 0 auto',
            width: isMobile ? '100%' : 'auto',
            maxHeight: isMobile ? '40vh' : 'none',
            overflowY: isMobile ? 'auto' : 'visible',
            backgroundColor: isMobile ? '#383838ff' : 'transparent',
            borderBottom: isMobile ? '1px solid #555' : 'none'
          }}>
            <NodePalette 
              onNodeDragStart={handleNodeDragStart}
              isMobile={isMobile} // Pass the mobile flag
            />
          
            
          </div>
        )}
        
        {/* Main Canvas Area */}
        <div style={{ 
          flex: '1',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative'
        }}>
          
          {/* Desktop Header */}
          {!isMobile && (
            <div style={{ marginBottom: '16px', padding: '20px 20px 0' }}>
              <h2 style={{ margin: '0 0 8px 0', color: '#ffffffff' }}>
                WORK IN PROGRESS WEBGPU FLOW DIAGRAM EDITOR
              </h2>
              <p style={{ margin: '0', color: '#ffffffff', fontSize: '14px' }}>
                - shape, resizing interactions, and label support are work in progress
              </p>
            </div>
          )}

          <div style={{position: 'absolute',  placeSelf: 'top',  top: 150, zIndex: '100' }}><VisualPropertyEditor/></div>

          <div style={{position: 'fixed', paddingTop: 200, paddingRight: 50, placeSelf: 'end', zIndex: '100' }}><ActionIcon variant='subtle' onClick={handleOpenSettingsMenu}><Settings16Regular/></ActionIcon></div>

          {settingsOpen && <div style={{backgroundColor: '#3e3e3eff', position: 'absolute',  width: 250, placeSelf: 'center', top: 250, zIndex: '100'}}>
          <div className="SettingsContentContainer">
            <div style={{ paddingTop: 10, paddingRight: 10, placeSelf: 'end', zIndex: '100' }}><ActionIcon variant='subtle' onClick={handleOpenSettingsMenu}><Dismiss16Regular/></ActionIcon></div>
            <h3 style={{justifyContent: 'center'}}>Settings</h3>
            <strong style={{color: 'yellow', fontSize: 10}}><Warning16Filled/> options not yet functional</strong>

            <div style={{display: 'block'}}>MSAA:
                {supportedSampleCount && supportedSampleCount.length > 0 && <NativeSelect onChange={(e) => {setSampleCount(e.currentTarget.value); console.log('sample count selected', e.currentTarget.value)}} value={sampleCount} data={supportedSampleCount}/>}
            </div>
          <div style={{display: 'block'}}>
              Supersampling: 
              <NativeSelect data={['Disabled', '2x', '4x', '8x']} onChange={(e) => {setSuperSamplingValue(e.currentTarget.value)}} value={superSamplingValue}/></div>
          </div>
          </div>}
          {/* Canvas Container */}
          <div style={{ 
            flex: '1',
            padding: isMobile ? '8px' : '16px',
            backgroundColor: 'inherit',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>

          <DiagramCanvas 
            width={canvasSize.width}
            height={canvasSize.height}
            setSupportedSampleCount={setSupportedSampleCount}
            onNodeDropped={handleNodeDropped}
            onSampleCountChange={setSampleCount}
            sampleCount={sampleCount}
            
          />

          <VisualContentNodesTest />
          </div>

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

        </div>
      </div>
    </DiagramProvider>
    
  );
};
