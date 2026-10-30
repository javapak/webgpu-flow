import { Anchor, Stack, Text, Title } from '@mantine/core';

export type WebGPUFailure = 'no-api' | 'no-device';

/** Shown instead of the editor when WebGPU can't be started. */
export default function WebGPUUnsupported({ reason }: { reason: WebGPUFailure }) {
  return (
    <div style={{ width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
      <Stack gap="sm" maw={460}>
        <Title order={2}>WebGPU isn't available</Title>
        {reason === 'no-api' ? (
          <Text c="dimmed">
            This editor draws everything with WebGPU, which this browser doesn't support yet.
            Try a recent version of Chrome, Edge or Safari.
          </Text>
        ) : (
          <Text c="dimmed">
            Your browser supports WebGPU but couldn't access the GPU. This usually means hardware
            acceleration is turned off in the browser settings, or the graphics driver is blocked.
          </Text>
        )}
        <Anchor href="https://github.com/gpuweb/gpuweb/wiki/Implementation-Status" target="_blank" rel="noreferrer" size="sm">
          WebGPU browser support
        </Anchor>
      </Stack>
    </div>
  );
}
