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
const report = process.argv[2] ?? 'trips'
const reports = {
  trips: { table: 'Рейсы APS', component: 'TripsDashboard', title: 'Отчёт по рейсам APS', slug: 'trips-dashboard-report', required: ['Рейсы APS', 'Параметры отчёта', 'Распределение по статусу', 'Циркуляция', 'Отказ ТС'], historicalDate: true },
  contracts: { table: 'Договоры', component: 'ContractsDashboard', title: 'Отчёт по договорам', slug: 'contracts-dashboard-report', required: ['Договоры и остатки', 'Параметры отчёта', 'Лимиты документов', 'Реестр документов'] },
  personnel: { table: 'Персонал', component: 'PersonnelDashboard', title: 'Отчёт по персоналу', slug: 'personnel-dashboard-report', required: ['Персонал', 'Параметры отчёта'] },
}
const config = reports[report]
if (!config) throw new Error(`Unknown report '${report}'. Use trips, contracts, or personnel.`)
const table = schema.find(item => item.name === config.table)
if (!table) throw new Error(`${config.table} table missing from snapshot schema`)

const recordsDir = path.join(snapshot, 'records')
const records = (await readFile(path.join(recordsDir, `${table.id}.jsonl`), 'utf8'))
  .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const fields = Object.fromEntries(table.fields.map(field => [field.id, { title: field.name, kind: field.type, options: field.options }]))

const NativeDate = Date
let reportYear
if (config.historicalDate) {
  const dateField = table.fields.find(field => field.name === 'Начало')
  const years = records.map(row => Number(String(row.fields?.[dateField?.id] ?? '').slice(0, 4))).filter(Number.isFinite)
  reportYear = Math.max(...years)
  if (!Number.isFinite(reportYear)) throw new Error('No dated trip records in snapshot')
  // Render the real trips component using the latest historical data year in this snapshot.
  globalThis.Date = class SnapshotDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [`${reportYear}-07-01T12:00:00Z`])) }
    static now() { return new NativeDate(`${reportYear}-07-01T12:00:00Z`).valueOf() }
  }
}

const server = await createServer({ configFile: path.join(root, 'web/vite.config.js'), root: path.join(root, 'web'), server: { middlewareMode: true }, appType: 'custom' })
try {
  const { default: Dashboard } = await server.ssrLoadModule(`/src/pages/${config.component}.jsx`)
  const rows = records.map(record => ({ id: record.id, ...record.fields }))
  const body = renderToString(React.createElement(Dashboard, { fields, rows }))
  const css = await readFile(path.join(root, `web/src/pages/${config.component}.css`), 'utf8')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${config.title}</title><style>${css}</style></head><body><main id="root">${body}</main></body></html>`
  const outDir = path.join(root, 'output/pdf')
  await mkdir(outDir, { recursive: true })
  const outFile = path.join(outDir, `${config.slug}.html`)
  await writeFile(outFile, html, 'utf8')
  const missing = config.required.filter(text => !html.includes(text))
  if (missing.length) throw new Error(`Rendered report is missing: ${missing.join(', ')}`)
  console.log(`Rendered ${rows.length} snapshot ${config.table}${reportYear ? ` (${reportYear})` : ''} to ${path.relative(root, outFile)}`)
} finally {
  globalThis.Date = NativeDate
  await server.close()
}
