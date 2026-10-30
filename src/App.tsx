import React, { useState, useEffect, useCallback} from 'react';
import "allotment/dist/style.css";
import '@mantine/core/styles.css'
import './App.css';
import { ActionIcon, Checkbox, NativeSelect } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {Dismiss16Regular} from '@fluentui/react-icons';
import { useDiagram } from './components/DiagramProvider';
import PropertyEditorPanel from './components/PropertyEditorPanel';
import { Allotment } from 'allotment';
import ERFlow from './components/ERFlow';
import Toolbar from './components/Toolbar';
import { RESOLUTION_OPTIONS, parseResolution, useRenderSettings } from './state/renderSettings';

// Below this width the split view doesn't fit (canvas pane min 400 + sidebar min 260),
// so the canvas goes full screen and properties move into a bottom sheet.
const COMPACT_QUERY = '(max-width: 768px)';

export const DiagramDemo: React.FC = () => {
  const compact = useMediaQuery(COMPACT_QUERY, window.matchMedia(COMPACT_QUERY).matches, { getInitialValueInEffect: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const resolution = useRenderSettings(s => s.resolution);
  const setResolution = useRenderSettings(s => s.setResolution);

  const { fxaaEnabled, smaaEnabled, setFXAAEnabled, setSMAAEnabled } = useDiagram();

  useEffect(() => {
    if (!settingsOpen && !propertiesOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsOpen) setSettingsOpen(false);
      else setPropertiesOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, propertiesOpen]);

  const handleOpenSettingsMenu = useCallback(() => {
     setSettingsOpen(open => !open);
  }, [])

  const toggleProperties = useCallback(() => setPropertiesOpen(open => !open), []);

  const canvasArea = (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Toolbar
        onOpenSettings={handleOpenSettingsMenu}
        compact={compact}
        propertiesOpen={propertiesOpen}
        onToggleProperties={compact ? toggleProperties : undefined}
      />
      <ERFlow/>

      {/* Properties bottom sheet (phones). Overlays the canvas rather than shrinking it,
          so opening it doesn't reconfigure the WebGPU render targets. */}
      {compact && propertiesOpen && (
        <div className="mobile-sheet" role="dialog" aria-label="Properties">
          <div className="mobile-sheet-header">
            <span>Properties</span>
            <ActionIcon variant="subtle" color="gray" size={40} aria-label="Close properties" onClick={toggleProperties}><Dismiss16Regular/></ActionIcon>
          </div>
          <div className="mobile-sheet-body">
            <PropertyEditorPanel />
          </div>
        </div>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div className="settings-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) handleOpenSettingsMenu(); }}>
          <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-header">
              <h2 id="settings-title">Settings</h2>
              <ActionIcon variant="subtle" color="gray" size={compact ? 40 : 28} aria-label="Close settings" onClick={handleOpenSettingsMenu}><Dismiss16Regular/></ActionIcon>
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
  );

  // One tree for both layouts: switching (rotating a tablet, narrowing a window) only hides
  // the sidebar, so the canvas isn't remounted and WebGPU isn't re-initialised.
  return (
    <div className="app-root">
      <Allotment defaultSizes={[78, 22]}>

        {/* Main Canvas Area */}
        <Allotment.Pane minSize={compact ? 0 : 400}>
          {canvasArea}
        </Allotment.Pane>

        {/* Sidebar: layout + properties */}
        <Allotment.Pane visible={!compact} minSize={260} maxSize={500} preferredSize={320}>
          <PropertyEditorPanel />
        </Allotment.Pane>
    </Allotment>
    </div>
  );
};
