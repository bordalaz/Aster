import { displayValue } from './cells.js'

// Условия фильтра; value не нужен для «пусто/не пусто».
export const OPS = {
  contains: 'содержит', not_contains: 'не содержит', eq: '=', neq: '≠',
  gt: '>', gte: '≥', lt: '<', lte: '≤', empty: 'пусто', not_empty: 'не пусто',
  any_of: 'любое из', none_of: 'ни одно из', contains_any: 'содержит любое из',
}
export const NO_VALUE = new Set(['empty', 'not_empty'])
// Значение — список (в поле ввода — через «;»); пришли из Airtable: «любое из» и ИЛИ по одной колонке.
export const LIST_OPS = new Set(['any_of', 'none_of', 'contains_any'])
const wantList = v => (Array.isArray(v) ? v : [v ?? '']).map(x => String(x).trim().toLowerCase()).filter(Boolean)

// Колонки сетки: первичное поле всегда первое и видно (R9); дальше — порядок вида, иначе все.
export function visibleColumns(fields, primaryField, columns) {
  const byName = new Map(fields.map(f => [f.column_name, f]))
  const prim = byName.get(primaryField)
  const order = columns ?? fields.map(f => f.column_name)
  const rest = order.filter(c => c !== primaryField && byName.has(c)).map(c => byName.get(c))
  return prim ? [prim, ...rest] : rest
}

// Колонки группировки: список (до 3 уровней); строка — старый формат вида.
export const groupCols = g => (typeof g === 'string' ? [g] : g ?? [])

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)

function compare(a, b) {
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return String(a).localeCompare(String(b), 'ru')   // даты YYYY-MM-DD сравниваются как строки
}

// Одно условие против значения ячейки. Текстовые сравнения — по тому, что видит человек, без регистра.
export function matches(field, value, { op, value: want }) {
  if (op === 'empty') return isEmpty(value)
  if (op === 'not_empty') return !isEmpty(value)
  if (LIST_OPS.has(op)) {
    const wants = wantList(want)
    // элементы ячейки: у multiSelect/ссылок — каждый по отдельности
    const items = isEmpty(value) ? [] : (Array.isArray(value) ? value : [value]).map(v => displayValue(field, v).toLowerCase())
    if (op === 'contains_any') return items.some(it => wants.some(w => it.includes(w)))
    const hit = items.some(it => wants.includes(it))
    return op === 'any_of' ? hit : !hit
  }
  const shown = isEmpty(value) ? '' : displayValue(field, value).toLowerCase()
  const w = want == null ? '' : String(want).toLowerCase()
  if (op === 'contains') return shown.includes(w)
  if (op === 'not_contains') return !shown.includes(w)
  if (typeof value === 'boolean') {
    const b = w === 'true' || w === 'да'
    return op === 'eq' ? value === b : op === 'neq' ? value !== b : false
  }
  const raw = typeof value === 'number' ? value : shown
  if (op === 'eq') return compare(raw, w) === 0
  if (op === 'neq') return compare(raw, w) !== 0
  if (isEmpty(value)) return false
  const d = compare(raw, w)
  return { gt: d > 0, gte: d >= 0, lt: d < 0, lte: d <= 0 }[op] ?? true
}

export function applyFilters(fields, rows, filters) {
  if (!filters?.length) return rows
  const byName = new Map(fields.map(f => [f.column_name, f]))
  const active = filters.filter(f => byName.has(f.col) &&
    (NO_VALUE.has(f.op) || (LIST_OPS.has(f.op) ? wantList(f.value).length > 0 : (f.value ?? '') !== '')))
  return rows.filter(r => active.every(f => matches(byName.get(f.col), r[f.col], f)))
}

// Сравнение конфигов без учёта порядка ключей; отсутствующий ключ = null — для отметки «не сохранено».
export function sameConfig(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  return [...keys].every(k => JSON.stringify((a ?? {})[k] ?? null) === JSON.stringify((b ?? {})[k] ?? null))
}
