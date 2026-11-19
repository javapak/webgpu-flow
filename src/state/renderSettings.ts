import { create } from 'zustand';

export interface Resolution { width: number; height: number }

export const RESOLUTION_OPTIONS = ['1280x720', '1920x1080', '2560x1440', '3840x2160'] as const;

export const parseResolution = (value: string): Resolution => {
  const [width, height] = value.split('x').map(Number);
  return { width, height };
};

/**
 * Colours of what the canvas draws itself (nodes and edges have their own): CSS colours,
 * `#rrggbb`, `#rrggbbaa` or `rgb()`/`rgba()`, so a host can pass its theme's straight through.
 */
export interface CanvasTheme {
  /** Behind everything. */
  background: string;
  /** Grid lines; drawn faint, so a foreground colour works. */
  grid: string;
  /** Text drawn on the background rather than on a node: edge labels. */
  text: string;
}

export const DEFAULT_CANVAS_THEME: CanvasTheme = { background: '#262626', grid: '#b3b3b3', text: '#ffffff' };

interface RenderSettings {
  /** Size of the canvas backing store. Affects sharpness and cost, not on-screen size. */
  resolution: Resolution;
  setResolution: (resolution: Resolution) => void;
  canvasTheme: CanvasTheme;
  setCanvasTheme: (theme: CanvasTheme) => void;
}

export const useRenderSettings = create<RenderSettings>(set => ({
  resolution: { width: 1920, height: 1080 },
  setResolution: resolution => set({ resolution }),
  canvasTheme: DEFAULT_CANVAS_THEME,
  setCanvasTheme: canvasTheme => set({ canvasTheme }),
}));

/** A CSS colour as RGBA 0..1: hex (3, 6 or 8 digits) or rgb()/rgba(); `fallback` for anything else. */
export function parseCssColor(color: string, fallback: [number, number, number, number]): [number, number, number, number] {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(d => d + d).join('') : hex[1];
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, a];
  }
  return fallback;
}
