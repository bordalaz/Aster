import { GridCellKind } from '@glideapps/glide-data-grid'
import { buttonStyle, choiceColor, LINK_PILL } from './renderers.js'

export const NUMBER = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'autoNumber'])
// Правятся прямо в сетке; остальные типы — только в карточке (в сетке читаются).
const INLINE = new Set([
  'singleLineText', 'multilineText', 'richText', 'email', 'url', 'phoneNumber',
  'number', 'currency', 'percent', 'rating', 'duration', 'checkbox', 'date', 'dateTime',
])
const COMPUTED = new Set(['formula', 'rollup', 'multipleLookupValues'])
// Lookup вложений API отдаёт id вложений — показывать нечего. Связи и их lookup приходят как [{id, name}].
const HIDDEN_LOOKUP = new Set(['multipleAttachments'])
export const isLink = f => kindOf(f) === 'multipleRecordLinks'
const SPECIAL = { NaN: 'NaN', Infinity: '∞', '-Infinity': '−∞' }

// Тип, по которому показываем: у формул/rollup/lookup — тип результата, count — число.
export function kindOf(field) {
  if (field.kind === 'count') return 'number'
  if (COMPUTED.has(field.kind)) return field.options?.result?.type ?? 'singleLineText'
  return field.kind
}

// Даты как в Airtable у владельца (сверено в живом Airtable 2026-11-02): local — «23.3.2018»,
// friendly — «23 Ноября 2021 г.»; время 24hour — «20:30», 12hour — «3:58дня»; дата и время — «23.3.2018 20:30».
// Зона: utc — по UTC, client — браузера, иначе — указанная в поле.
export const DATE_KINDS = new Set(['date', 'dateTime', 'createdTime', 'lastModifiedTime'])
const MONTHS = ['Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня', 'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря']
const fmtOpts = f => f.options?.result?.options ?? f.options ?? {}   // у формул, createdTime, lastModifiedTime — в result
const pad2 = x => String(x).padStart(2, '0')
const meridiem = h => (h < 4 ? 'ночи' : h < 12 ? 'утра' : h < 17 ? 'дня' : 'вечера')   // как moment ru

const zoneOf = o => (o.timeZone === 'utc' ? 'UTC' : o.timeZone && o.timeZone !== 'client' ? o.timeZone : undefined)
const zoneParts = (t, timeZone) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t).map(x => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute }
}

// Значение → части в зоне поля: {y, m, d} у даты, плюс {h, mi} у даты со временем; null — не дата.
export function dateParts(field, value) {
  if (typeof value !== 'string') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const [y, m, d] = value.split('-').map(Number); return { y, m, d } }
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? null : zoneParts(t, zoneOf(fmtOpts(field)))
}

// Части в зоне поля → значение для сервера: «YYYY-MM-DD» или ISO-время (UTC).
export function partsToValue(field, { y, m, d, h, mi }) {
  if (h == null) return `${y}-${pad2(m)}-${pad2(d)}`
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const p = zoneParts(new Date(guess), zoneOf(fmtOpts(field)))   // поправка на смещение зоны
  return new Date(guess - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess)).toISOString()
}

export const hasTime = field => !!fmtOpts(field).timeFormat || field.kind === 'dateTime'

// Только дата, в формате поля: «23.3.2018» (friendly в поле ввода — тоже «23.3.2018»).
export function dayText(field, { y, m, d }) {
  const f = fmtOpts(field).dateFormat?.name
  return f === 'us' ? `${m}/${d}/${y}` : f === 'european' ? `${d}/${m}/${y}` : f === 'iso' ? `${y}-${pad2(m)}-${pad2(d)}` : `${d}.${m}.${y}`
}

// Ввод даты, как в Airtable: «23.3.2018» (us — «3/23/2018»), «2018-03-23»; время — «20:30». null — не разобрать.
export function parseDay(field, text) {
  const t = String(text ?? '').trim()
  let y, m, d, r
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, m, d] = [+r[1], +r[2], +r[3]]
  else if ((r = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) {
    [d, m, y] = [+r[1], +r[2], +r[3]]
    if (fmtOpts(field).dateFormat?.name === 'us') [d, m] = [m, d]
  } else return null
  const ok = new Date(Date.UTC(y, m - 1, d))
  return ok.getUTCMonth() === m - 1 && ok.getUTCDate() === d ? { y, m, d } : null
}
export function parseTime(text) {
  const r = /^(\d{1,2})[:.](\d{2})$/.exec(String(text ?? '').trim())
  return r && +r[1] < 24 && +r[2] < 60 ? { h: +r[1], mi: +r[2] } : null
}

// Вставка из Excel: «23.3.2018 20:30», «2018-03-23T20:30» → значение; undefined — не разобрать.
export function parseDateText(field, text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(t) && !Number.isNaN(new Date(t).getTime())) return hasTime(field) ? new Date(t).toISOString() : t.slice(0, 10)
  const [ds, ts] = t.split(/\s+/)
  const day = parseDay(field, ds)
  if (!day) return undefined
  if (!hasTime(field)) return partsToValue(field, day)
  const time = ts ? parseTime(ts) : { h: 0, mi: 0 }
  return time ? partsToValue(field, { ...day, ...time }) : undefined
}

export function dateText(field, value) {
  const o = fmtOpts(field)
  const p = dateParts(field, value)
  if (!p) return String(value)
  const { y, m, d, h, mi } = p
  const date = o.dateFormat?.name === 'friendly' ? `${d} ${MONTHS[m - 1]} ${y} г.` : dayText(field, p)
  if (h == null || !o.timeFormat) return date
  const time = o.timeFormat.name === '12hour' ? `${h % 12 || 12}:${pad2(mi)}${meridiem(h)}` : `${pad2(h)}:${pad2(mi)}`
  return `${date} ${time}`
}

// Длительность Airtable хранит секундами, показывает «ч:мм» (или «ч:мм:сс»).
const durFormat = f => (COMPUTED.has(f.kind) ? f.options?.result?.options : f.options)?.durationFormat ?? 'h:mm'

export function durText(field, sec) {
  const s = Math.round(Math.abs(sec)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60
  const pad = x => String(x).padStart(2, '0')
  return (sec < 0 ? '-' : '') + `${h}:${pad(m)}` + (durFormat(field) === 'h:mm' ? '' : `:${pad(s % 60)}`)
}

// «85:40» / «1:02:05» → секунды; число без «:» — часы. '' → null, мусор → undefined (не сохраняем).
export function parseDuration(text) {
  const t = String(text ?? '').trim().replace(',', '.')
  if (t === '') return null
  const hm = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(t)
  if (hm) return +hm[1] * 3600 + +hm[2] * 60 + +(hm[3] ?? 0)
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 3600) : undefined
}

// Число → текст: точность поля как в Airtable; без неё — срезаем шум float (0.1+0.2).
export function numText(field, n) {
  if (kindOf(field) === 'duration') return durText(field, n)
  const p = field.kind === 'count' ? 0
    : COMPUTED.has(field.kind) ? field.options?.result?.options?.precision : field.options?.precision
  return p == null ? String(Number(n.toPrecision(15))) : n.toFixed(p)
}

// Значение → текст: NaN/Infinity и ошибка Airtable приходят объектом.
function asText(field, value) {
  if (value == null) return ''
  if (field.kind === 'multipleLookupValues' && HIDDEN_LOOKUP.has(kindOf(field))) return ''
  if (value.specialValue) return SPECIAL[value.specialValue] ?? value.specialValue
  if (value.error) return value.error
  if (typeof value === 'object' && !Array.isArray(value) && value.name) return value.name   // пользователь Airtable
  if (Array.isArray(value)) return value.map(v => asText(field, v)).filter(Boolean).join(', ')
  if (typeof value === 'number') return numText(field, value)
  if (DATE_KINDS.has(kindOf(field)) && typeof value === 'string') return dateText(field, value)
  return String(value)
}

export function displayValue(field, value) {
  return asText(field, value) || '—'
}

// Ключ для сортировки групп и строк: у дат — сырое ISO (по показанному «23.3.2018» порядок сломается), иначе — текст.
export function sortKey(field, value) {
  const v = Array.isArray(value) ? value[0] : value
  return DATE_KINDS.has(kindOf(field)) && typeof v === 'string' ? v : displayValue(field, value)
}

const SELECT = new Set(['singleSelect', 'multipleSelects'])
const asList = v => (v == null ? [] : Array.isArray(v) ? v.flat() : [v])
const choicesOf = f => (COMPUTED.has(f.kind) ? f.options?.result?.options : f.options)?.choices ?? []
const pillsCell = (items, round) => ({
  kind: GridCellKind.Custom, allowOverlay: false, readonly: true,
  copyData: items.map(i => i.text).join(', '), data: { kind: 'pills', items, round },
})

export function toCell(field, value) {
  const kind = kindOf(field)
  if (field.kind === 'button') {   // поле-кнопка (card/ButtonField.jsx)
    const o = field.options ?? {}
    const { background, color } = buttonStyle(o.variant)
    return { kind: GridCellKind.Custom, allowOverlay: false, readonly: true, copyData: '',
      data: { kind: 'btn', label: o.label ?? field.title, bg: background, fg: color, off: !o.action || o.action.kind === 'script' } }
  }
  const editable = field.editable && INLINE.has(field.kind)
  if (kind === 'checkbox' && !Array.isArray(value)) {
    const color = choiceColor(field.options?.color ?? 'greenBright').bg
    return { kind: GridCellKind.Custom, allowOverlay: false, readonly: !field.editable, copyData: value ? 'да' : '',
      data: { kind: 'check', value: !!value, color } }
  }
  if (SELECT.has(kind)) {   // плашки цвета варианта, как в Airtable; свои поля выбора правятся списком в ячейке
    const choices = choicesOf(field)
    const colors = Object.fromEntries(choices.map(c => [c.name, c.color]))
    const cell = pillsCell(asList(value).filter(v => v != null && v !== '').map(v => ({ text: String(v), ...choiceColor(colors[v]) })), true)
    if (!(field.editable && SELECT.has(field.kind))) return cell
    return { ...cell, allowOverlay: true, readonly: false,
      data: { ...cell.data, choices, multi: field.kind === 'multipleSelects', value: value ?? (field.kind === 'multipleSelects' ? [] : null) } }
  }
  if (kind === 'multipleRecordLinks') {   // связи — «таблетки» с названиями записей
    return pillsCell(asList(value).filter(v => v?.name).map(v => ({ text: v.name, ...LINK_PILL })), false)
  }
  if (kind === 'duration' && (value == null || typeof value === 'number')) {
    const text = value == null ? '' : durText(field, value)
    return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: editable }
  }
  if (NUMBER.has(kind) && (value == null || typeof value === 'number')) {
    return {
      kind: GridCellKind.Number, data: value ?? undefined,
      displayData: value == null ? '' : numText(field, value), allowOverlay: editable,
    }
  }
  const text = asText(field, value)
  if (editable && (field.kind === 'date' || field.kind === 'dateTime')) {   // правится календарём, как в Airtable
    return { kind: GridCellKind.Custom, allowOverlay: true, readonly: false, copyData: text,
      data: { kind: 'date', text, value: value ?? null, field } }
  }
  return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: editable }
}

export function fromCell(field, cell) {
  if (field.kind === 'checkbox') return !!(cell.kind === GridCellKind.Custom ? cell.data.value : cell.data)
  if (SELECT.has(field.kind)) return cell.kind === GridCellKind.Custom ? cell.data.value : undefined
  if (field.kind === 'duration') return parseDuration(cell.data)
  if (cell.kind === GridCellKind.Custom && cell.data?.kind === 'date') return cell.data.value
  if (field.kind === 'date' || field.kind === 'dateTime') return parseDateText(field, cell.data)
  if (NUMBER.has(field.kind)) return cell.data ?? null
  return cell.data === '' ? null : cell.data
}
