import { displayValue, kindOf } from '../grid/cells.js'
import { choiceColor } from '../grid/renderers.js'
import { Icon } from '../ui/icons.jsx'

export const Pill = ({ name, color, round = true }) => {
  const c = color === 'link' ? { bg: '#e9eef6', fg: '#1d1f25' } : choiceColor(color)
  return <span className="pill" style={{ background: c.bg, color: c.fg, borderRadius: round ? 999 : 4 }}>{name}</span>
}

// Значение в мини-карточке, как в Airtable: галочка — ✓, выбор — плашка цвета варианта, пусто — ничего.
function MiniValue({ field, value }) {
  if (kindOf(field) === 'checkbox') return value ? <span className="link-card-check" aria-label="да"><Icon name="check" size={14} /></span> : <span />
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return <span />
  const choices = (field.options?.result?.options ?? field.options)?.choices
  if (choices) {
    const colors = Object.fromEntries(choices.map(c => [c.name, c.color]))
    return <span>{[].concat(value).map(v => <Pill key={v} name={v} color={colors[v]} />)}</span>
  }
  return <span className="link-card-val">{displayValue(field, value)}</span>
}

// Поля мини-карточки связанной записи: подпись и значение.
export default function MiniFields({ cols, row }) {
  if (!row || !cols.length) return null
  return (
    <span className="link-card-fields">{cols.map(c => (
      <span key={c.column_name}><small>{c.title}</small><MiniValue field={c} value={row[c.column_name]} /></span>
    ))}</span>
  )
}
