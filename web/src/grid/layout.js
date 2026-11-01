import { displayValue, kindOf, NUMBER, numText } from './cells.js'
import { choiceColor, HUE_SHADES } from './renderers.js'
import { applyFilters } from './viewConfig.js'

const keyCompare = (a, b) => a.localeCompare(b, 'ru', { numeric: true })

// Строки сетки с группировкой по одной или нескольким колонкам: заголовок группы + её строки (свёрнутые — без строк).
// Порядок строк внутри группы — как пришёл (сортировка вида), группы — по названию, «—» (пусто) в конце.
// Свёрнутые группы — по пути ключей (верхний уровень — просто ключ).
export function groupRows(rows, fields, collapsed = new Set(), depth = 0, path = []) {
  const [field, ...rest] = (Array.isArray(fields) ? fields : [fields]).filter(Boolean)
  if (!field) return rows.map(row => ({ kind: 'row', row }))
  const groups = new Map()
  for (const row of rows) {
    const key = displayValue(field, row[field.column_name])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '—') - (b === '—') || keyCompare(a, b))
  return keys.flatMap(key => {
    const p = [...path, key], id = p.join(''), folded = collapsed.has(id)
    return [
      { kind: 'group', key, id, depth, count: groups.get(key).length, collapsed: folded },
      ...(folded ? [] : groupRows(groups.get(key), rest, collapsed, depth + 1, p)),
    ]
  })
}

const isNum = f => NUMBER.has(kindOf(f)) || f.kind === 'count'

// Итог колонки по видимым (отфильтрованным) строкам: числа — сумма, остальное — сколько заполнено.
// ponytail: вид итога не выбирается (Airtable даёт среднее/мин/макс) — добавить в config вида, если попросят
export function columnTotal(field, rows) {
  if (isNum(field)) {
    let sum = 0, n = 0
    for (const r of rows) {
      const v = r[field.column_name]
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++ }
    }
    return n ? `Σ ${numText(field, sum)}` : ''
  }
  const filled = rows.filter(r => {
    const v = r[field.column_name]
    return v != null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)
  }).length
  return filled ? `заполнено ${filled}` : ''
}

// --- CSV для Excel (R9, R37/E19) ---
// Разделитель «;» и BOM — так русский Excel открывает файл без мастера импорта; дробная часть — запятая.
const FORMULA = /^[=+\-@\t\r]/

export function csvCell(field, value) {
  let text
  if (typeof value === 'number' && isNum(field)) text = numText(field, value).replace('.', ',')
  else {
    text = value == null ? '' : displayValue(field, value)
    if (text === '—') text = ''
    if (FORMULA.test(text)) text = "'" + text   // E19: не даём Excel выполнить формулу из данных
  }
  return /[;"\n\r]/.test(text) || text.startsWith("'") ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCSV(cols, rows) {
  const lines = [cols.map(c => csvCell({ kind: 'singleLineText' }, c.title)).join(';')]
  for (const r of rows) lines.push(cols.map(c => csvCell(c, r[c.column_name])).join(';'))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

// --- вставка из Excel ---
// Числа в русском Excel: «1 234,5» (пробелы, в т.ч. неразрывные, и запятая).
export function parsePastedNumber(text) {
  const t = String(text).replace(/[\s  ]/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined   // undefined — не число, ячейку пропускаем
}

export function parsePastedBool(text) {
  return /^(1|да|true|истина|yes|x|✓)$/i.test(String(text).trim())
}

// --- итоги внизу по настройке вида (summaryBarConfigs Airtable) ---
const LABEL = { sum: 'Сумма', average: 'Средн.', median: 'Медиана', min: 'Мин.', max: 'Макс.', countUnique: 'Уникальных',
  count: 'Заполнено', earliestDate: 'Самая ранняя', latestDate: 'Самая поздняя' }
const ruDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}.${m}.${y}` }

export function summarize(field, rows, fn) {
  if (!LABEL[fn]) return ''
  const vals = rows.map(r => r[field.column_name]).filter(v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
  if (fn === 'count') return `${LABEL[fn]} ${vals.length}`
  if (fn === 'countUnique') return `${LABEL[fn]} ${new Set(vals.map(v => JSON.stringify(v))).size}`
  if (fn === 'earliestDate' || fn === 'latestDate') {
    const ds = vals.map(String).sort()
    return ds.length ? `${LABEL[fn]} ${ruDate(fn === 'earliestDate' ? ds[0] : ds[ds.length - 1])}` : ''
  }
  const ns = vals.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!ns.length) return ''
  const sum = ns.reduce((a, b) => a + b, 0)
  const v = fn === 'sum' ? sum : fn === 'average' ? sum / ns.length : fn === 'min' ? ns[0] : fn === 'max' ? ns[ns.length - 1]
    : ns.length % 2 ? ns[(ns.length - 1) / 2] : (ns[ns.length / 2 - 1] + ns[ns.length / 2]) / 2
  return `${LABEL[fn]} ${numText(field, v)}`
}

// --- цвет строки (colorConfig вида): по полю выбора или по первому сработавшему правилу ---
const BAR = { Light: 1, Medium: 2, Dark: 3, Darker: 3 }   // оттенок полосы → ступень палитры Airtable
export function rowColor(color, fields, row) {
  if (!color) return null
  if (color.kind === 'select') {
    const f = fields.find(x => x.column_name === color.col)
    const v = row[color.col]
    const choice = (f?.options?.choices ?? []).find(c => c.name === (Array.isArray(v) ? v[0] : v))
    return choice ? choiceColor(choice.color).bg : null
  }
  for (const r of color.rules ?? []) {
    if (applyFilters(fields, [row], r.filters).length) {
      const m = /^([a-z]+)(Light|Medium|Dark|Darker)?$/.exec(r.color ?? '')
      if (!m) return null
      return HUE_SHADES[m[1]]?.[m[2] ? BAR[m[2]] : 2] ?? null
    }
  }
  return null
}

// --- ручной порядок вида: записи по rowOrder, новые (которых там нет) — в конце ---
export function orderRows(rows, order) {
  if (!order?.length) return rows
  const pos = new Map(order.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
}
