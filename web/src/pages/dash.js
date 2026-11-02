import { displayValue } from '../grid/cells.js'
import { matches } from '../grid/viewConfig.js'

const EMPTY = '(пусто)'
const OTHER = 'Другое'
const MAX_SERIES = 9   // столько цветов в палитре; хвост — в «Другое», новых оттенков не придумываем

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
  const cell = new Map([...buckets].map(([k, rs]) => [k, aggregate(rs, fields[y.col], y.agg) ?? 0]))
  const xs = [...new Set([...buckets.keys()].map(k => k.split('\u0000')[0]))].sort(cmp)
  let groups = [null]
  let fold = new Map()
  if (group) {
    const total = new Map()
    for (const [k, v] of cell) { const g = k.split('\u0000')[1]; total.set(g, (total.get(g) ?? 0) + v) }
    const all = [...total.keys()].sort(cmp)
    if (all.length > MAX_SERIES) {
      const keep = new Set([...all].sort((a, b) => total.get(b) - total.get(a)).slice(0, MAX_SERIES - 1))
      fold = new Map(all.filter(g => !keep.has(g)).map(g => [g, OTHER]))
      groups = [...all.filter(g => keep.has(g)), OTHER]
    } else groups = all
  }
  const value = (kx, kg) => {
    if (kg !== OTHER) return cell.get(`${kx}\u0000${kg}`) ?? 0
    return [...fold.keys()].reduce((s, g) => s + (cell.get(`${kx}\u0000${g}`) ?? 0), 0)
  }
  return { xs, groups, value }
}
