import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The API and the socket are proxied to the backend so the browser always talks to a
// single origin — the same shape production has when Express serves the built client.
const BACKEND = 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // /shared lives outside this project root, so Vite needs permission to read it.
    fs: { allow: ['..'] },
    proxy: {
      '/api': BACKEND,
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
})
