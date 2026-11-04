import { readFile } from 'node:fs/promises'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// не встраивать приложение во фрейм чужого сайта (clickjacking) — как и ответы API
const headers = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }

// «Открыть снимок» — тот же веб на 5201, API — экземпляр снимка (snapshot-api, 8001)
const snap = process.argv.includes('5201')

// Glide 6.0.3 начинает правку по набору только для ASCII — кириллица («Корпус…») ячейку не открывала.
// Как в Airtable: любой печатный символ открывает правку. ponytail: замена строки в коде Glide — при обновлении Glide проверить.
const ASCII = '/[ -~]/g.test(event.key)', ANY = '!/\\p{C}/u.test(event.key)'
const typeAny = code => code.replace(ASCII, ANY)
const glideFile = /glide-data-grid[\\/]dist[\\/].*data-editor\.js$/
const glideTyping = {
  name: 'glide-type-any-letter',
  transform: (code, id) => (glideFile.test(id) ? typeAny(code) : null),   // сборка
}
const glideTypingDev = {   // dev: Glide заранее собирается esbuild — правим там же
  name: 'glide-type-any-letter',
  setup: b => b.onLoad({ filter: glideFile }, async a => ({ contents: typeAny(await readFile(a.path, 'utf8')), loader: 'js' })),
}

export default defineConfig({
  plugins: [react(), glideTyping],
  optimizeDeps: { esbuildOptions: { plugins: [glideTypingDev] } },
  server: { port: snap ? 5201 : 5200, proxy: { '/api': snap ? 'http://localhost:8001' : 'http://localhost:8000' }, headers },
  preview: { headers },
})
