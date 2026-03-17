import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    base: '/',
    server: {
      // Proxy /api to Vercel so Topic Analyzer Admin works on localhost
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'https://ce-x-insights-main-1.vercel.app',
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})
