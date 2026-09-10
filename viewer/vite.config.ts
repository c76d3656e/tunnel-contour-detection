import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pyodideCdn = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs'

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: {
    format: 'es',
    rollupOptions: {
      external: [pyodideCdn],
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
})
