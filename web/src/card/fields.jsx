import { useEffect, useState } from 'react'
import { api } from '../api.js'
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

// Мини-карточки связей, как в Airtable: название + первые 3 поля первого общего вида связанной таблицы.
// ponytail: метаданные таблицы кешируются на сессию вкладки; поля таблиц меняются редко
const meta = new Map()
const tableMeta = tableId => {
  if (!meta.has(tableId)) {
    meta.set(tableId, Promise.all([api('/api/tables'), api(`/api/tables/${tableId}/fields`), api(`/api/tables/${tableId}/views`)])
      .then(([tables, fields, views]) => {
        const primary = tables.find(t => t.id === tableId)?.primary_field
        const order = views[0]?.config?.columns ?? fields.map(f => f.column_name)
        return order.filter(c => c !== primary).map(c => fields.find(f => f.column_name === c)).filter(Boolean).slice(0, 3)
      })
      .catch(e => { meta.delete(tableId); throw e }))
  }
  return meta.get(tableId)
}

function LinkCards({ id, field, list, onOpenLink }) {
  const [prev, setPrev] = useState(null)   // {cols, rows: {id: row}}
  const key = list.map(v => v.id).join(',')
  useEffect(() => {
    let live = true
    Promise.all([tableMeta(field.link_table), api(`/api/tables/${field.link_table}/records?ids=${key}`)])
      .then(([cols, rows]) => live && setPrev({ cols, rows: Object.fromEntries(rows.map(r => [r.id, r])) }))
      .catch(() => {})   // нет данных — карточки только с названием
    return () => { live = false }
  }, [field.link_table, key])
  return (
    <div id={id} className="link-cards">{list.map(v => {
      const row = prev?.rows[v.id]
      return (
        <button key={v.id} type="button" className="link-card" title={v.name} onClick={() => onOpenLink?.(field.link_table, v.id)}>
          <span className="link-card-name">{v.name || `№${v.id}`}</span>
          {row && prev.cols.length > 0 && (
            <span className="link-card-fields">{prev.cols.map(c => (
              <span key={c.column_name}><small>{c.title}</small><span className="link-card-val">{displayValue(c, row[c.column_name]) || '—'}</span></span>
            ))}</span>
          )}
        </button>
      )
    })}</div>
  )
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
      ? <LinkCards id={id} field={field} list={list} onOpenLink={onOpenLink} />
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
