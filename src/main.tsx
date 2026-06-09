import { createRoot } from 'react-dom/client'
import './index.css'
import { MantineProvider } from '@mantine/core'
import { DiagramProvider } from './components/DiagramProvider.tsx';
import ERFlow from './components/ERFlow.tsx';

window.console.log = () => {};

createRoot(document.getElementById('root')!).render(
        <MantineProvider defaultColorScheme='dark'>
                <DiagramProvider>
                        <ERFlow />
                </DiagramProvider>
        </MantineProvider>
)
