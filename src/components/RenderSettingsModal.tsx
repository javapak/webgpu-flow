import { Checkbox, Modal, NativeSelect, Stack, Text } from '@mantine/core';
import { useDiagram } from './DiagramProvider';
import { RESOLUTION_OPTIONS, parseResolution, useRenderSettings } from '../state/renderSettings';

export interface RenderSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  /** Use the whole screen, as on phones. */
  fullScreen?: boolean;
}

/** Render settings for the diagram in the surrounding DiagramProvider: internal resolution and anti-aliasing. */
export default function RenderSettingsModal({ opened, onClose, fullScreen = false }: RenderSettingsModalProps) {
  const resolution = useRenderSettings(s => s.resolution);
  const setResolution = useRenderSettings(s => s.setResolution);
  const { fxaaEnabled, smaaEnabled, setFXAAEnabled, setSMAAEnabled } = useDiagram();

  return (
    <Modal opened={opened} onClose={onClose} title="Settings" centered size="sm" fullScreen={fullScreen}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">Display</Text>
          <NativeSelect
            label="Resolution"
            description="Render sharpness; on-screen size is unchanged"
            data={[...RESOLUTION_OPTIONS]}
            value={`${resolution.width}x${resolution.height}`}
            onChange={e => setResolution(parseResolution(e.currentTarget.value))}
          />
        </Stack>
        <Stack gap="xs">
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">Anti-aliasing</Text>
          <Checkbox label="FXAA" checked={fxaaEnabled} onChange={e => setFXAAEnabled(e.currentTarget.checked)} />
          <Checkbox label="SMAA" checked={smaaEnabled} onChange={e => setSMAAEnabled(e.currentTarget.checked)} />
        </Stack>
      </Stack>
    </Modal>
  );
}
