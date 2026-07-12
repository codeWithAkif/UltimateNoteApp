import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Crucial for Electron relative paths
  server: {
    port: 5173,
    strictPort: true
  },
  optimizeDeps: {
    entries: ['index.html']
  }
})
