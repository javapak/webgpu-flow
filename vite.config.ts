import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'elkjs/lib/elk.bundled.js': 'elkjs/lib/elk.bundled.js',
    }
  },
  optimizeDeps: {
    exclude: ['elkjs/lib/elk.bundled.js', 'web-worker'],
    include: ['elkjs'],
  }
});