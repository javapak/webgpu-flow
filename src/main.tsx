import { createRoot } from 'react-dom/client'
import './index.css'
import { MantineProvider } from '@mantine/core'
import { DiagramProvider } from './components/DiagramProvider.tsx';
import type { DiagramEdit } from './utils/DiagramEdits.ts';
import { DiagramDemo } from './App.tsx';
import WebGPUUnsupported, { type WebGPUFailure } from './components/WebGPUUnsupported.tsx';
import globalRenderer from './renderers/gpuInstance.ts';

/** Starts the shared renderer; returns why it couldn't, or null on success. */
async function startRenderer(): Promise<WebGPUFailure | null> {
  if (!navigator.gpu) return 'no-api';
  try {
    if (!(await globalRenderer.initialize())) return 'no-device';
    await globalRenderer.initializeLabelRenderer();
    await globalRenderer.initializeFloatingEdgeRenderer();
    return null;
  } catch (error) {
    console.error('Renderer failed to start:', error);
    return 'no-device';
  }
}

const failure = await startRenderer();

// Development aid and usage example: a host would turn these into its own updates.
const logEdit = import.meta.env.DEV ? (edit: DiagramEdit) => console.debug('[edit]', JSON.stringify(edit)) : undefined;

createRoot(document.getElementById('root')!).render(
        <MantineProvider defaultColorScheme='dark'>
                {failure ? <WebGPUUnsupported reason={failure} /> : (
                        <DiagramProvider onEdit={logEdit}>
                                <DiagramDemo/>
                        </DiagramProvider>
                )}
        </MantineProvider>
)
