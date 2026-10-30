import { Button, NativeSelect, Slider, Text } from '@mantine/core';
import { useDiagram } from './DiagramProvider';
import type { LayoutAlgorithm, LayoutDirection, EdgeRouting } from '../layout/graphLayout';
import { useLayoutStore } from '../layout/layoutStore';
import { useRunLayout } from '../hooks/useRunLayout';

const ALGORITHMS: { value: LayoutAlgorithm; label: string }[] = [
  { value: 'layered', label: 'Layered (hierarchical)' },
  { value: 'tree', label: 'Tree' },
  { value: 'radial', label: 'Radial' },
  { value: 'stress', label: 'Stress (organic)' },
  { value: 'force', label: 'Force-directed' },
  { value: 'box', label: 'Packed boxes' },
];
const DIRECTIONS: { value: LayoutDirection; label: string }[] = [
  { value: 'RIGHT', label: 'Left to right' },
  { value: 'DOWN', label: 'Top to bottom' },
  { value: 'LEFT', label: 'Right to left' },
  { value: 'UP', label: 'Bottom to top' },
];
const ROUTINGS: { value: EdgeRouting; label: string }[] = [
  { value: 'ORTHOGONAL', label: 'Orthogonal' },
  { value: 'POLYLINE', label: 'Polyline' },
  { value: 'STRAIGHT', label: 'Straight' },
];

export default function LayoutPanel() {
  const { fitToContent } = useDiagram();
  const layoutOptions = useLayoutStore(s => s.options);
  const setOptions = useLayoutStore(s => s.setOptions);
  const { run: runLayout, running: layoutRunning, error: layoutError } = useRunLayout();

  return (
    <div style={{ padding: 12, borderBottom: '1px solid #444' }}>
            <Text fw={600} mb={4}>Layout</Text>
            <NativeSelect label="Algorithm" data={ALGORITHMS} value={layoutOptions.algorithm}
              onChange={(e) => setOptions({ algorithm: e.currentTarget.value as LayoutAlgorithm })} />
            {(layoutOptions.algorithm === 'layered' || layoutOptions.algorithm === 'tree') && (
              <NativeSelect label="Direction" data={DIRECTIONS} value={layoutOptions.direction}
                onChange={(e) => setOptions({ direction: e.currentTarget.value as LayoutDirection })} />
            )}
            {layoutOptions.algorithm === 'layered' && (
              <NativeSelect label="Edge routing" data={ROUTINGS} value={layoutOptions.edgeRouting}
                onChange={(e) => setOptions({ edgeRouting: e.currentTarget.value as EdgeRouting })} />
            )}
            <Text size="sm" mt="xs">Spacing</Text>
            <Slider min={0.4} max={3} step={0.1} value={layoutOptions.spacing} label={(v) => `${v.toFixed(1)}x`}
              onChange={(v) => setOptions({ spacing: v })} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button size="xs" loading={layoutRunning} onClick={runLayout}>Apply layout</Button>
              <Button size="xs" variant="default" onClick={() => fitToContent()}>Fit to view</Button>
            </div>
            {layoutError && <Text size="xs" c="red" mt="xs">Layout failed: {layoutError}</Text>}
    </div>
  );
}
