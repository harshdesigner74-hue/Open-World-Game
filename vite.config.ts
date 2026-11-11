import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1' },
  // relative asset URLs so the build runs from any folder (static hosts, claude.ai artifacts)
  base: './',
  build: { chunkSizeWarningLimit: 4000 },
})
