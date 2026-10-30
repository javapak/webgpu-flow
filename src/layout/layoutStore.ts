import { create } from 'zustand';
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions } from './graphLayout';

// Shared so the sidebar's controls and the toolbar's "Auto layout" button agree on settings and status.
interface LayoutStore {
  options: LayoutOptions;
  running: boolean;
  error: string | null;
  setOptions: (update: Partial<LayoutOptions>) => void;
  setStatus: (status: { running: boolean; error?: string | null }) => void;
}

export const useLayoutStore = create<LayoutStore>(set => ({
  options: DEFAULT_LAYOUT_OPTIONS,
  running: false,
  error: null,
  setOptions: update => set(state => ({ options: { ...state.options, ...update } })),
  setStatus: ({ running, error = null }) => set({ running, error }),
}));
