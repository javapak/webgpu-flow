import { createRoot } from 'react-dom/client'
import './index.css'
import { MantineProvider } from '@mantine/core'
import { DiagramProvider } from './components/DiagramProvider.tsx';
import { DiagramDemo } from './App.tsx';
import globalRenderer from './renderers/gpuInstance.ts';

await globalRenderer.initialize()
await globalRenderer.initializeLabelRenderer();
await globalRenderer.initializeFloatingEdgeRenderer();


createRoot(document.getElementById('root')!).render(
        <MantineProvider defaultColorScheme='dark'>
                <DiagramProvider>
                        <DiagramDemo/>
                </DiagramProvider>
        </MantineProvider>
)
