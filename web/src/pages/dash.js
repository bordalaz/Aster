import { displayValue } from '../grid/cells.js'
import { matches } from '../grid/viewConfig.js'

const EMPTY = '(пусто)'

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)
const items = v => (isEmpty(v) ? [] : Array.isArray(v) ? v : [v])
const num = v => (Array.isArray(v) ? v.reduce((s, x) => s + (Number(x) || 0), 0) : Number(v))

// Условия фильтра страницы. Без значения — заготовка Airtable для зрителя: не фильтрует, пока не заполнена.
export function applyConds(rows, fields, conds) {
  const live = conds.filter(c => c.op === 'empty' || c.op === 'not_empty' || !isEmpty(c.value))
  return rows.filter(r => live.every(c => !fields[c.col] || matches(fields[c.col], r[c.col], c)))
}

export function aggregate(rows, field, agg) {
  if (agg === 'count') return rows.length
  const col = field?.column_name
  if (agg === 'filled') return rows.filter(r => !isEmpty(r[col])).length
  if (agg === 'unique') return new Set(rows.flatMap(r => items(r[col]).map(v => displayValue(field, v)))).size
  const ns = rows.map(r => r[col]).filter(v => !isEmpty(v)).map(num).filter(n => !Number.isNaN(n))
  if (!ns.length) return null
  if (agg === 'max') return Math.max(...ns)
  if (agg === 'min') return Math.min(...ns)
  const sum = ns.reduce((s, n) => s + n, 0)
  return agg === 'avg' ? sum / ns.length : sum
}

// Подписи значения по оси X/группе: многозначные (ссылки, мультивыбор) — каждое отдельно, как в Airtable.
function keys(field, v, bucket) {
  const its = items(v)
  if (!its.length) return [EMPTY]
  if (bucket) return its.map(x => String(x).slice(0, bucket === 'year' ? 4 : bucket === 'month' ? 7 : 10))
  return its.map(x => displayValue(field, x))
}

const cmp = (a, b) => (a === EMPTY) - (b === EMPTY) || a.localeCompare(b, 'ru', { numeric: true })

// → { xs, groups, value(x, group) }. Без разбивки — одна серия, group = null.
export function series(rows, fields, { x, bucket, group, y, empty }) {
  const buckets = new Map()   // "x\u0000g" → строки
  for (const r of rows) {
    for (const kx of keys(fields[x], r[x], bucket)) {
      if (kx === EMPTY && !empty) continue
      for (const kg of group ? keys(fields[group], r[group]) : [null]) {
        const k = `${kx}\u0000${kg}`
        if (!buckets.has(k)) buckets.set(k, [])
        buckets.get(k).push(r)
      }
    }
  }
  // Корзина без единого числа (сумма по пустым ячейкам) не попадает на ось — Airtable её не рисует.
  const cell = new Map([...buckets].map(([k, rs]) => [k, aggregate(rs, fields[y.col], y.agg)]).filter(([, v]) => v != null))
  const part = (k, i) => k.split('\u0000')[i]
  const xs = [...new Set([...cell.keys()].map(k => part(k, 0)))].sort(cmp)
  // Все серии, сколько есть, — как в Airtable; в «Другое» не сворачиваем.
  const groups = group ? [...new Set([...cell.keys()].map(k => part(k, 1)))].sort(cmp) : [null]
  const value = (kx, kg) => cell.get(`${kx}\u0000${kg}`) ?? 0
  return { xs, groups, value }
}
