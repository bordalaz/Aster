import { GridCellKind } from '@glideapps/glide-data-grid'

export const NUMBER = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'autoNumber'])
// Правятся прямо в сетке; остальные типы — только в карточке (в сетке читаются).
const INLINE = new Set([
  'singleLineText', 'multilineText', 'richText', 'email', 'url', 'phoneNumber',
  'number', 'currency', 'percent', 'rating', 'duration', 'checkbox', 'date',
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

// Число → текст: точность поля как в Airtable; без неё — срезаем шум float (0.1+0.2).
export function numText(field, n) {
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
  return String(value)
}

export function displayValue(field, value) {
  return asText(field, value) || '—'
}

// R14/R20: индиго — «нужное ТО» плашкой, оранжевый — скоро, красный — просрочено, серый — нет данных
const TONES = {
  accent: { textDark: '#2F3E9E', bgCell: '#ECEEF8', baseFontStyle: '600 13px' },
  orange: { textDark: '#F08A24' }, red: { textDark: '#D93025' }, muted: { textDark: '#8A8F98' },
}

export function toCell(field, value) {
  if (field.options?.computed) {   // регламент ТО: {name, tone, title}
    const t = value?.name ?? ''
    return { kind: GridCellKind.Text, data: t, displayData: t, allowOverlay: false, readonly: true,
      themeOverride: TONES[value?.tone] }
  }
  const kind = kindOf(field)
  const editable = field.editable && INLINE.has(field.kind)
  if (kind === 'checkbox') {
    return { kind: GridCellKind.Boolean, data: !!value, allowOverlay: false, readonly: !field.editable }
  }
  if (NUMBER.has(kind) && (value == null || typeof value === 'number')) {
    return {
      kind: GridCellKind.Number, data: value ?? undefined,
      displayData: value == null ? '' : numText(field, value), allowOverlay: editable,
    }
  }
  const text = asText(field, value)
  return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: editable }
}

export function fromCell(field, cell) {
  if (field.kind === 'checkbox') return !!cell.data
  if (NUMBER.has(field.kind)) return cell.data ?? null
  return cell.data === '' ? null : cell.data
}
