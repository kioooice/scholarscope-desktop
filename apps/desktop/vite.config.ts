import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.SCHOLARSCOPE_API_PORT || '5181'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
