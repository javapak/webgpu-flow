import { create } from 'zustand';

export interface Resolution { width: number; height: number }

export const RESOLUTION_OPTIONS = ['1280x720', '1920x1080', '2560x1440', '3840x2160'] as const;

export const parseResolution = (value: string): Resolution => {
  const [width, height] = value.split('x').map(Number);
  return { width, height };
};

interface RenderSettings {
  /** Size of the canvas backing store. Affects sharpness and cost, not on-screen size. */
  resolution: Resolution;
  setResolution: (resolution: Resolution) => void;
}

export const useRenderSettings = create<RenderSettings>(set => ({
  resolution: { width: 1920, height: 1080 },
  setResolution: resolution => set({ resolution }),
}));
