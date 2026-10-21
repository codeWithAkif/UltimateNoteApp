import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Crucial for Electron relative paths
  // Performans kaydındaki CPU profilinde fonksiyon adları okunabilsin diye değişken/fonksiyon adları küçültülmez
  // (boşluk ve sözdizimi yine küçültülür; boyut etkisi gzip sonrası küçüktür).
  esbuild: { minifyIdentifiers: false, keepNames: true },
  server: {
    port: 5173,
    strictPort: true
  },
  optimizeDeps: {
    entries: ['index.html']
  }
})
