import { useCallback } from 'react';
import { useDiagram } from '../components/DiagramProvider';
import { useLayoutStore } from '../layout/layoutStore';

/** Runs the layout with the current sidebar settings and tracks its status. */
export function useRunLayout() {
  const { applyLayout } = useDiagram();
  const running = useLayoutStore(s => s.running);
  const error = useLayoutStore(s => s.error);

  const run = useCallback(async () => {
    const { options, running: busy, setStatus } = useLayoutStore.getState();
    if (busy) return;
    setStatus({ running: true });
    try {
      await applyLayout(options);
      setStatus({ running: false });
    } catch (err) {
      console.error('Layout failed', err);
      setStatus({ running: false, error: err instanceof Error ? err.message : String(err) });
    }
  }, [applyLayout]);

  return { run, running, error };
}
