import { displayValue, kindOf, NUMBER, numText } from './cells.js'

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
