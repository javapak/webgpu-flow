import { create } from 'zustand';
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions } from './graphLayout';
import { prefersReducedMotion } from './layoutAnimation';

// Shared so the sidebar's controls and the toolbar's "Auto layout" button agree on settings and status.
interface LayoutStore {
  options: LayoutOptions;
  /** Animate nodes to their new positions. Off by default when the OS asks for reduced motion. */
  animate: boolean;
  running: boolean;
  error: string | null;
  setOptions: (update: Partial<LayoutOptions>) => void;
  setAnimate: (animate: boolean) => void;
  setStatus: (status: { running: boolean; error?: string | null }) => void;
}

export const useLayoutStore = create<LayoutStore>(set => ({
  options: DEFAULT_LAYOUT_OPTIONS,
  animate: !prefersReducedMotion(),
  running: false,
  error: null,
  setOptions: update => set(state => ({ options: { ...state.options, ...update } })),
  setAnimate: animate => set({ animate }),
  setStatus: ({ running, error = null }) => set({ running, error }),
}));
