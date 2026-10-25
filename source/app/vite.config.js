import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build`         -> normal multi-file build (dist/)
// `npm run build:single`  -> one self-contained HTML file (dist-single/index.html): the OFFLINE DEMO (demo sign-in on)
// `npm run build:deploy`  -> one self-contained HTML file (dist-deploy/index.html) for the college site:
//                            demo sign-in compiled out, Google sign-in only
// `--mode e2e`             -> like deploy, plus a test hook for browser tests (never deployed)
export default defineConfig(({ mode }) => ({
  plugins: ['single', 'deploy', 'e2e'].includes(mode) ? [react(), viteSingleFile()] : [react()],
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'deploy' ? 'dist-deploy' : mode === 'e2e' ? 'dist-e2e' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
  // __E2E__: browser tests only (`--mode e2e`). Lets the test drive "Continue with Google" with tokens signed by a
  // local test key; the server still verifies every token, and this code is compiled out of every other build.
  define: { __SINGLE_FILE__: JSON.stringify(['single', 'deploy', 'e2e'].includes(mode)), __DEMO__: JSON.stringify(mode !== 'deploy' && mode !== 'e2e'), __E2E__: JSON.stringify(mode === 'e2e') },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
}))
