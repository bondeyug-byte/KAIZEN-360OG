import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build`         -> normal multi-file build for Netlify/Vercel (dist/)
// `npm run build:single`  -> one self-contained HTML file (dist-single/index.html) for offline demos
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
  define: { __SINGLE_FILE__: JSON.stringify(mode === 'single') },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
}))
