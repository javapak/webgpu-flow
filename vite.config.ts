import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['elkjs'],
  },
  build: {
    commonjsOptions: {
      // Forces Rollup/Vite to treat elkjs as a CommonJS module with a default export
      transformMixedEsModules: true, 
    },
  },
})
