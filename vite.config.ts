import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/openaire': {
        target: 'https://api.openaire.eu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openaire/, ''),
      },
      '/api/unpaywall': {
        target: 'https://api.unpaywall.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/unpaywall/, ''),
      },
    },
  },
})
