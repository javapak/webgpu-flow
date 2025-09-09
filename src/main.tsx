import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import {DiagramDemo} from './App.tsx'

createRoot(document.getElementById('root')!).render(

    <DiagramDemo />
)
