import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/hub-display': 'http://127.0.0.1:5000',
      '/hub-checkin': 'http://127.0.0.1:5000',
      '/api': 'http://127.0.0.1:5000',
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
      },
      '/brand': 'http://127.0.0.1:5000',
    },
  },
})
