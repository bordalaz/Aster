import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// не встраивать приложение во фрейм чужого сайта (clickjacking) — как и ответы API
const headers = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }

export default defineConfig({
  plugins: [react()],
  server: { port: 5200, proxy: { '/api': 'http://localhost:8000' }, headers },
  preview: { headers },
})
