import { displayValue, isLink } from '../grid/cells.js'

const TEXT = new Set(['singleLineText', 'email', 'url', 'phoneNumber'])
const MULTILINE = new Set(['multilineText', 'richText'])
const NUMBER = new Set(['number', 'currency', 'percent', 'rating', 'duration'])

// Один редактор поля по его kind. Неэдитируемое — только показ.
export default function FieldEditor({ field, value, onChange, onOpenLink }) {
  const id = `f-${field.column_name ?? field.title}`
  const label = <label htmlFor={id} style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{field.title}</label>

  // связанные записи (R11): кнопки-переходы, если таблица видна роли; правка связей — позже, с формами
  if (isLink(field) && field.link_table && Array.isArray(value) && value.length) {
    return <div>{label}<div id={id} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0' }}>
      {value.map(v => <button key={v.id} type="button" className="btn" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={v.name} onClick={() => onOpenLink?.(field.link_table, v.id)}>{v.name || `№${v.id}`}</button>)}
    </div></div>
  }
  if (!field.editable) {
    return <div>{label}<div id={id} style={{ padding: '6px 0' }}>{displayValue(field, value)}</div></div>
  }
  if (field.kind === 'checkbox') {
    return <div><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input id={id} type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} aria-label={field.title} />{field.title}
    </label></div>
  }
  if (field.kind === 'singleSelect') {
    const choices = field.options?.choices ?? []
    return <div>{label}<select id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">—</option>
      {choices.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
    </select></div>
  }
  if (field.kind === 'multipleSelects') {
    const choices = field.options?.choices ?? []
    const set = new Set(value ?? [])
    const toggle = name => { const n = new Set(set); n.has(name) ? n.delete(name) : n.add(name); onChange([...n]) }
    return <div>{label}<div>{choices.map(c => (
      <label key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={set.has(c.name)} onChange={() => toggle(c.name)} />{c.name}
      </label>))}</div></div>
  }
  if (field.kind === 'date') {
    return <div>{label}<input id={id} type="date" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} /></div>
  }
  if (field.kind === 'dateTime') {
    const local = value ? String(value).slice(0, 16) : ''
    return <div>{label}<input id={id} type="datetime-local" aria-label={field.title} value={local} onChange={e => onChange(e.target.value || null)} /></div>
  }
  if (NUMBER.has(field.kind)) {
    return <div>{label}<input id={id} type="number" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></div>
  }
  if (MULTILINE.has(field.kind)) {
    return <div>{label}<textarea id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} rows={3} style={{ width: '100%' }} /></div>
  }
  if (TEXT.has(field.kind)) {
    return <div>{label}<input id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={{ width: '100%' }} /></div>
  }
  // jsonb и прочее — показ только для чтения (этап 2)
  return <div>{label}<div id={id} className="mono" style={{ padding: '6px 0' }}>{value == null ? '—' : JSON.stringify(value)}</div></div>
}
