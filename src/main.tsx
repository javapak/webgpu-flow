import { createRoot } from 'react-dom/client'
import './index.css'
import {DiagramDemo} from './App.tsx'
import { MantineProvider } from '@mantine/core'
import { DiagramProvider } from './components/DiagramProvider.tsx';

createRoot(document.getElementById('root')!).render(
        <MantineProvider defaultColorScheme='dark'>
                <DiagramProvider>
                        <DiagramDemo />
                </DiagramProvider>
        </MantineProvider>
)
