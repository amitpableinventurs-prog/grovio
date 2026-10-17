import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Admin panel is 5173, customer web 5174.
  server: {
    port: 5190,
    strictPort: true,
  },
})
