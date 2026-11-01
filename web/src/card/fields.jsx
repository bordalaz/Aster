import { displayValue, durText, isLink, parseDuration } from '../grid/cells.js'
import { choiceColor } from '../grid/renderers.js'
import { fieldIcon, Icon } from '../ui/icons.jsx'

const TEXT = new Set(['singleLineText', 'email', 'url', 'phoneNumber'])
const MULTILINE = new Set(['multilineText', 'richText'])
const NUMBER = new Set(['number', 'currency', 'percent', 'rating'])

const Pill = ({ name, color, round = true }) => {
  const c = color === 'link' ? { bg: '#e9eef6', fg: '#1d1f25' } : choiceColor(color)
  return <span className="pill" style={{ background: c.bg, color: c.fg, borderRadius: round ? 999 : 4 }}>{name}</span>
}

// Один редактор поля по его kind. Неэдитируемое — только показ.
// inline — раскладка карточки Airtable (подпись слева); без него — подпись сверху (формы).
export default function FieldEditor({ field, value, onChange, onOpenLink, inline = false }) {
  const id = `f-${field.column_name ?? field.title}`
  const label = (
    <label htmlFor={id} className="fld-label">
      <Icon name={fieldIcon(field.kind)} size={14} />{field.title}
      {field.description && <span className="info" title={field.description} aria-label={`Описание: ${field.description}`}><Icon name="info" size={13} /></span>}
    </label>
  )
  const wrap = control => <div className={inline ? 'fld fld-inline' : 'fld'}>{label}<div className="fld-value">{control}</div></div>

  // связанные записи (R11): мини-карточки, щелчок — переход к записи; правка связей — позже
  if (isLink(field)) {
    const list = Array.isArray(value) ? value : []
    return wrap(list.length && field.link_table
      ? <div id={id} className="link-cards">{list.map(v => (
          <button key={v.id} type="button" className="link-card" title={v.name} onClick={() => onOpenLink?.(field.link_table, v.id)}>
            {v.name || `№${v.id}`}
          </button>))}</div>
      : <div id={id} className="fld-ro">—</div>)
  }
  if (!field.editable) {
    const choices = (field.options?.result?.options ?? field.options)?.choices
    if (choices && value != null && value !== '') {
      const colors = Object.fromEntries(choices.map(c => [c.name, c.color]))
      return wrap(<div id={id} className="fld-ro">{[].concat(value).map(v => <Pill key={v} name={v} color={colors[v]} />)}</div>)
    }
    return wrap(<div id={id} className="fld-ro">{displayValue(field, value)}</div>)
  }
  if (field.kind === 'checkbox') {
    return wrap(<input id={id} type="checkbox" className="fld-check" checked={!!value} onChange={e => onChange(e.target.checked)} aria-label={field.title} />)
  }
  if (field.kind === 'singleSelect') {
    const choices = field.options?.choices ?? []
    const color = choices.find(c => c.name === value)?.color
    // плашка цвета варианта, поверх — невидимый системный список (доступен с клавиатуры и читалок)
    return wrap(
      <div className="fld-input fld-select">
        {value ? <Pill name={value} color={color} /> : <span style={{ color: 'var(--faint)' }}>—</span>}
        <Icon name="caretDown" size={12} style={{ marginLeft: 'auto', color: 'var(--muted)' }} />
        <select id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
          <option value="">—</option>
          {choices.map(c => <option key={c.id ?? c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>)
  }
  if (field.kind === 'multipleSelects') {
    const choices = field.options?.choices ?? []
    const set = new Set(value ?? [])
    const toggle = name => { const n = new Set(set); n.has(name) ? n.delete(name) : n.add(name); onChange([...n]) }
    return wrap(<div id={id} className="fld-multi">{choices.map(c => (
      <label key={c.id ?? c.name} className="row">
        <input type="checkbox" checked={set.has(c.name)} onChange={() => toggle(c.name)} /><Pill name={c.name} color={c.color} />
      </label>))}</div>)
  }
  if (field.kind === 'date') {
    return wrap(<input id={id} className="fld-input" style={{ width: 160 }} type="date" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} />)
  }
  if (field.kind === 'dateTime') {
    const local = value ? String(value).slice(0, 16) : ''
    return wrap(<input id={id} className="fld-input" style={{ width: 220 }} type="datetime-local" aria-label={field.title} value={local} onChange={e => onChange(e.target.value || null)} />)
  }
  if (field.kind === 'duration') {
    // «ч:мм», как в Airtable; разбираем при уходе с поля, нераспознанное не сохраняем
    const shown = value == null ? '' : durText(field, value)
    return wrap(<input id={id} className="fld-input" key={shown} aria-label={field.title} defaultValue={shown} placeholder="ч:мм"
      onBlur={e => { const v = parseDuration(e.target.value); if (v === undefined) e.target.value = shown; else if (v !== value) onChange(v) }} />)
  }
  if (NUMBER.has(field.kind)) {
    return wrap(<input id={id} className="fld-input" type="number" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />)
  }
  if (MULTILINE.has(field.kind)) {
    return wrap(<textarea id={id} className="fld-input fld-area" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} rows={3} />)
  }
  if (TEXT.has(field.kind)) {
    return wrap(<input id={id} className="fld-input" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} />)
  }
  // jsonb и прочее — показ только для чтения
  return wrap(<div id={id} className="fld-ro mono">{value == null ? '—' : JSON.stringify(value)}</div>)
}
