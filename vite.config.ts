import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Tells Vite/Rollup that 'web-worker' is external and shouldn't be bundled
      external: ['web-worker'],
    },
  },
});

