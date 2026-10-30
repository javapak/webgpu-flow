import { useEffect, type ReactNode } from 'react';
import { ActionIcon, Button, Divider, Loader, Tooltip } from '@mantine/core';
import {
  Cursor20Regular,
  DrawShape20Regular,
  Flowchart20Regular,
  Grid20Regular,
  PanelBottom20Regular,
  Settings20Regular,
  ZoomFit20Regular,
  ZoomIn20Regular,
  ZoomOut20Regular,
} from '@fluentui/react-icons';
import { InteractionMode, useDiagram } from './DiagramProvider';
import { useRunLayout } from '../hooks/useRunLayout';

const ZOOM_STEP = 1.25;

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  /** Larger hit area for touch screens. */
  large?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ label, shortcut, active, disabled, large, onClick, children }: ToolButtonProps) {
  return (
    <Tooltip label={shortcut ? `${label} (${shortcut})` : label} openDelay={400} events={{ hover: true, focus: true, touch: false }}>
      <ActionIcon
        size={large ? 40 : 34}
        variant={active ? 'filled' : 'subtle'}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
};

interface ToolbarProps {
  onOpenSettings: () => void;
  /** Phone layout: bigger buttons, and controls with a touch equivalent (pinch zoom) or a Settings equivalent are dropped. */
  compact?: boolean;
  /** Shown only when provided (the phone layout, where properties live in a bottom sheet). */
  onToggleProperties?: () => void;
  propertiesOpen?: boolean;
}

export default function Toolbar({ onOpenSettings, compact = false, onToggleProperties, propertiesOpen = false }: ToolbarProps) {
  const {
    nodes, viewport, mode, toggleMode, exitDrawMode, drawingState,
    fitToContent, zoomBy, setZoom,
    gridSnapping, setGridSnapping,
    fxaaEnabled, setFXAAEnabled, smaaEnabled, setSMAAEnabled,
    focusedOnInput,
  } = useDiagram();
  const { run: runLayout, running: layoutRunning } = useRunLayout();

  const drawing = mode === InteractionMode.DRAW_EDGE;
  const empty = nodes.length === 0;

  const setDrawMode = (on: boolean) => {
    if (on && !drawing) toggleMode();
    if (!on && drawing) exitDrawMode();
  };

  // Keyboard shortcuts. Ignored while typing in a field or with modifier keys held
  // (Alt is reserved for temporarily bypassing snap).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || focusedOnInput) return;
      switch (e.key) {
        case 'f': case 'F': case 'Home': fitToContent(); break;
        case '+': case '=': zoomBy(ZOOM_STEP); break;
        case '-': case '_': zoomBy(1 / ZOOM_STEP); break;
        case '0': setZoom(1); break;
        case 'v': case 'V': setDrawMode(false); break;
        case 'e': case 'E': setDrawMode(true); break;
        case 'g': case 'G': setGridSnapping(!gridSnapping.enabled); break;
        case 'l': case 'L': void runLayout(); break;
        case 'Escape': if (drawing || drawingState.isDrawing) exitDrawMode(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      style={{
        position: 'absolute',
        top: 'max(12px, calc(env(safe-area-inset-top) + 8px))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        maxWidth: 'calc(100% - 16px)',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        borderRadius: 10,
        background: 'rgba(30, 30, 30, 0.92)',
        border: '1px solid #444',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(6px)',
        // The toolbar sits over the canvas; its own taps must not become canvas gestures.
        touchAction: 'manipulation',
      }}
    >
      <ToolButton label="Select and move" shortcut="V" large={compact} active={!drawing} onClick={() => setDrawMode(false)}>
        <Cursor20Regular />
      </ToolButton>
      <ToolButton label="Draw edge" shortcut="E" large={compact} active={drawing} onClick={() => setDrawMode(true)}>
        <DrawShape20Regular />
      </ToolButton>

      {!compact && <Divider orientation="vertical" mx={4} />}

      <ToolButton label="Fit graph to view" shortcut="F" large={compact} disabled={empty} onClick={() => fitToContent()}>
        <ZoomFit20Regular />
      </ToolButton>
      {!compact && (<>
      <ToolButton label="Zoom out" shortcut="-" onClick={() => zoomBy(1 / ZOOM_STEP)}>
        <ZoomOut20Regular />
      </ToolButton>
      <Tooltip label="Reset to 100% (0)" openDelay={400} events={{ hover: true, focus: true, touch: false }}>
        <Button
          variant="subtle"
          size="compact-sm"
          color="gray"
          aria-label="Reset zoom to 100%"
          onClick={() => setZoom(1)}
          style={{ minWidth: 52, fontVariantNumeric: 'tabular-nums' }}
        >
          {Math.round(viewport.zoom * 100)}%
        </Button>
      </Tooltip>
      <ToolButton label="Zoom in" shortcut="+" onClick={() => zoomBy(ZOOM_STEP)}>
        <ZoomIn20Regular />
      </ToolButton>
      </>)}

      {!compact && <Divider orientation="vertical" mx={4} />}

      <ToolButton label="Auto layout" shortcut="L" large={compact} disabled={empty || layoutRunning} onClick={() => void runLayout()}>
        {layoutRunning ? <Loader size={16} /> : <Flowchart20Regular />}
      </ToolButton>
      <ToolButton label="Snap to grid (hold Alt to bypass)" shortcut="G" large={compact} active={gridSnapping.enabled} onClick={() => setGridSnapping(!gridSnapping.enabled)}>
        <Grid20Regular />
      </ToolButton>

      {!compact && <Divider orientation="vertical" mx={4} />}

      {!compact && (<>
      <Button size="compact-sm" variant={fxaaEnabled ? 'filled' : 'subtle'} color={fxaaEnabled ? undefined : 'gray'} aria-pressed={fxaaEnabled} onClick={() => setFXAAEnabled(!fxaaEnabled)}>
        FXAA
      </Button>
      <Button size="compact-sm" variant={smaaEnabled ? 'filled' : 'subtle'} color={smaaEnabled ? undefined : 'gray'} aria-pressed={smaaEnabled} onClick={() => setSMAAEnabled(!smaaEnabled)}>
        SMAA
      </Button>
      </>)}

      {onToggleProperties && (
        <ToolButton label="Properties" large={compact} active={propertiesOpen} onClick={onToggleProperties}>
          <PanelBottom20Regular />
        </ToolButton>
      )}

      <ToolButton label="Settings" large={compact} onClick={onOpenSettings}>
        <Settings20Regular />
      </ToolButton>
    </div>
  );
}
