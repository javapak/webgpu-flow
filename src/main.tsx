import { createRoot } from 'react-dom/client'
import './index.css'
import {DiagramDemo} from './App.tsx'
import { MantineProvider } from '@mantine/core'

createRoot(document.getElementById('root')!).render(
        <MantineProvider defaultColorScheme='dark'>
                <DiagramDemo />
        </MantineProvider>
)
