import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fromWeb = createRequire(path.join(root, 'web/package.json'))
const React = fromWeb('react')
const { renderToString } = fromWeb('react-dom/server')
const { createServer } = fromWeb('vite')
const snapshot = path.join(root, 'data/snapshot')
const schema = JSON.parse(await readFile(path.join(snapshot, 'schema.json'), 'utf8'))
const tripTable = schema.find(table => table.name === 'Рейсы APS')
if (!tripTable) throw new Error('Рейсы APS table missing from snapshot schema')

const recordsDir = path.join(snapshot, 'records')
const records = (await readFile(path.join(recordsDir, `${tripTable.id}.jsonl`), 'utf8'))
  .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const fields = Object.fromEntries(tripTable.fields.map(field => [field.id, { title: field.name, kind: field.type, options: field.options }]))
const dateField = tripTable.fields.find(field => field.name === 'Начало')
const years = records.map(row => Number(String(row.fields?.[dateField?.id] ?? '').slice(0, 4))).filter(Number.isFinite)
const reportYear = Math.max(...years)
if (!Number.isFinite(reportYear)) throw new Error('No dated trip records in snapshot')

// Render the real component using the latest historical data year in this snapshot.
const NativeDate = Date
globalThis.Date = class SnapshotDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [`${reportYear}-07-01T12:00:00Z`])) }
  static now() { return new NativeDate(`${reportYear}-07-01T12:00:00Z`).valueOf() }
}

const server = await createServer({ configFile: path.join(root, 'web/vite.config.js'), root: path.join(root, 'web'), server: { middlewareMode: true }, appType: 'custom' })
try {
  const { default: TripsDashboard } = await server.ssrLoadModule('/src/pages/TripsDashboard.jsx')
  const rows = records.map(record => ({ id: record.id, ...record.fields }))
  const body = renderToString(React.createElement(TripsDashboard, { fields, rows }))
  const css = await readFile(path.join(root, 'web/src/pages/TripsDashboard.css'), 'utf8')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Отчёт по рейсам APS</title><style>${css}</style></head><body><main id="root">${body}</main></body></html>`
  const outDir = path.join(root, 'output/pdf')
  await mkdir(outDir, { recursive: true })
  const outFile = path.join(outDir, 'trips-dashboard-report.html')
  await writeFile(outFile, html, 'utf8')
  const required = ['Рейсы APS', 'Параметры отчёта', 'Распределение по статусу', 'Циркуляция', 'Отказ ТС']
  const missing = required.filter(text => !html.includes(text))
  if (missing.length) throw new Error(`Rendered report is missing: ${missing.join(', ')}`)
  console.log(`Rendered ${rows.length} snapshot trips (${reportYear}) to ${path.relative(root, outFile)}`)
} finally {
  globalThis.Date = NativeDate
  await server.close()
}
