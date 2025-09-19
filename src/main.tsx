import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import {DiagramDemo} from './App.tsx'
import { DiagramProvider } from './components/DiagramProvider.tsx'

createRoot(document.getElementById('root')!).render(
    <DiagramProvider>
        <DiagramDemo />
    </DiagramProvider>
)
