import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Intercepts ANY import trying to access elk.bundled.js and redirects it
      'elkjs/lib/elk.bundled.js': 'elkjs/lib/elk-worker.js',
    },
  },
})