import { GridCellKind } from '@glideapps/glide-data-grid'

const NUMBER = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'autoNumber'])
// Правятся прямо в сетке; остальные типы — только в карточке (в сетке читаются).
const INLINE = new Set([
  'singleLineText', 'multilineText', 'richText', 'email', 'url', 'phoneNumber',
  'number', 'currency', 'percent', 'rating', 'duration', 'checkbox', 'date',
])

export function toCell(field, value) {
  const editable = field.editable && INLINE.has(field.kind)
  if (field.kind === 'checkbox') {
    return { kind: GridCellKind.Boolean, data: !!value, allowOverlay: false, readonly: !field.editable }
  }
  if (NUMBER.has(field.kind)) {
    return {
      kind: GridCellKind.Number, data: value ?? undefined,
      displayData: value == null ? '' : String(value), allowOverlay: editable,
    }
  }
  const text = value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value)
  return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: editable }
}

export function fromCell(field, cell) {
  if (field.kind === 'checkbox') return !!cell.data
  if (NUMBER.has(field.kind)) return cell.data ?? null
  return cell.data === '' ? null : cell.data
}
