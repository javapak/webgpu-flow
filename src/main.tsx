import { createRoot } from 'react-dom/client'
import './index.css'
import { MantineProvider } from '@mantine/core'
import { DiagramProvider } from './components/DiagramProvider.tsx';
import type { DiagramEdit } from './utils/DiagramEdits.ts';
import { DiagramDemo } from './App.tsx';
import WebGPUUnsupported from './components/WebGPUUnsupported.tsx';
import { startRenderer } from './renderers/startRenderer.ts';

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
