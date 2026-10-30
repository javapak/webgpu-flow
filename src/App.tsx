
import React, { useState, useEffect, useCallback} from 'react';
import "allotment/dist/style.css";
import '@mantine/core/styles.css'
import './App.css';
import { ActionIcon, Checkbox, NativeSelect } from '@mantine/core';
import {Dismiss16Regular} from '@fluentui/react-icons';
import { useDiagram } from './components/DiagramProvider';
import PropertyEditorPanel from './components/PropertyEditorPanel';
import { Allotment } from 'allotment';
import "allotment/dist/style.css";
import ERFlow from './components/ERFlow';
import Toolbar from './components/Toolbar';
import { RESOLUTION_OPTIONS, parseResolution, useRenderSettings } from './state/renderSettings';

// Mobile detection utility
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
};



export const DiagramDemo: React.FC = () => {
  const [isMobile, setIsMobile] = useState(isMobileDevice());
  //const [canvasSize, setCanvasSize] = useState(getOptimalCanvasSize());
  const [settingsOpen, setSettingsOpen] = useState(false);
  //const [supportedSampleCount, setSupportedSampleCount] = useState<string[] | undefined>(['1']);
  const resolution = useRenderSettings(s => s.resolution);
  const setResolution = useRenderSettings(s => s.setResolution);

  const { fxaaEnabled, smaaEnabled, setFXAAEnabled, setSMAAEnabled } = useDiagram();
  




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
      //setCanvasSize(getOptimalCanvasSize());
      
    };
    handleResize(); // Initial check

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /*const handleNodeDropped = (nodeType: NodeType, position: { x: number; y: number }) => {
    console.log(`Dropped ${nodeType.name} at position:`, position);
    
    // Provide haptic feedback on mobile
    if (isMobile && navigator.vibrate) {
      navigator.vibrate(100);
    }
  }; */

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  const handleOpenSettingsMenu = useCallback(() => {
     setSettingsOpen(!settingsOpen);
  }, [settingsOpen, setSettingsOpen])

  return (
    <div style={{ width: '100vw', height: '100vh'}}>
      <Allotment defaultSizes={[78, 22]}>

        {/* Main Canvas Area */}
        <Allotment.Pane minSize={400}>
        <div style={{display: 'relative', height: '100vh'}}>      

          {/* Canvas Container */}

          <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
            <Toolbar onOpenSettings={handleOpenSettingsMenu} />
            <ERFlow/>
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

          {/* Settings modal */}
          {settingsOpen && (
            <div className="settings-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) handleOpenSettingsMenu(); }}>
              <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                <div className="settings-header">
                  <h2 id="settings-title">Settings</h2>
                  <ActionIcon variant="subtle" color="gray" aria-label="Close settings" onClick={handleOpenSettingsMenu}><Dismiss16Regular/></ActionIcon>
                </div>

                <div className="settings-body">
                  <section className="settings-section">
                    <h3>Display</h3>
                    <NativeSelect label="Resolution" description="Render sharpness; on-screen size is unchanged" data={[...RESOLUTION_OPTIONS]} value={`${resolution.width}x${resolution.height}`} onChange={(e) => setResolution(parseResolution(e.currentTarget.value))} />
                  </section>

                  <section className="settings-section">
                    <h3>Anti-aliasing</h3>
                    <Checkbox label="FXAA" checked={fxaaEnabled} onChange={(e) => setFXAAEnabled(e.currentTarget.checked)}/>
                    <Checkbox label="SMAA" checked={smaaEnabled} onChange={(e) => setSMAAEnabled(e.currentTarget.checked)}/>
                  </section>
                </div>
              </div>
            </div>)}
      </div>
        </Allotment.Pane>

        {/* Sidebar: layout + properties */}
        <Allotment.Pane minSize={260} maxSize={500} preferredSize={320}>
          <PropertyEditorPanel />
        </Allotment.Pane>
    </Allotment>
    </div>
  );
};