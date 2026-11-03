import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// не встраивать приложение во фрейм чужого сайта (clickjacking) — как и ответы API
const headers = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }

// «Открыть снимок» — тот же веб на 5201, API — экземпляр снимка (snapshot-api, 8001)
const snap = process.argv.includes('5201')

export default defineConfig({
  plugins: [react()],
  server: { port: snap ? 5201 : 5200, proxy: { '/api': snap ? 'http://localhost:8001' : 'http://localhost:8000' }, headers },
  preview: { headers },
})
