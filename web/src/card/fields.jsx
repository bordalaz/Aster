import { useEffect, useRef, useState } from 'react'
import DatePicker from '../ui/DatePicker.jsx'
import { api } from '../api.js'
import { displayValue, durText, isLink, parseDuration } from '../grid/cells.js'
import { fieldIcon, Icon } from '../ui/icons.jsx'
import LinkSearch from '../links/LinkSearch.jsx'
import MiniFields, { Pill } from '../links/MiniFields.jsx'
import { createLinked, openRecord, tableMeta } from '../links/data.js'

const TEXT = new Set(['singleLineText', 'email', 'url', 'phoneNumber'])
const MULTILINE = new Set(['multilineText', 'richText'])
const NUMBER = new Set(['number', 'currency', 'percent', 'rating'])

// Мини-карточки связей, как в Airtable: название + первые 3 поля первого общего вида связанной таблицы.
// Правится (роль правит таблицу и видит связанную): «+ Добавить» — поиск записи, «×» на карточке — убрать связь.
function LinkField({ id, field, list, onChange, onOpenLink }) {
  const [cols, setCols] = useState([])
  const [rows, setRows] = useState({})
  const [adding, setAdding] = useState(false)
  const key = list.map(v => v.id).join(',')
  const editable = field.editable && field.link_table && onChange
  const single = !!field.options?.prefersSingleRecordLink
  useEffect(() => {
    if (!field.link_table || !key) return
    let live = true
    Promise.all([tableMeta(field.link_table), api(`/api/tables/${field.link_table}/records?ids=${key}`)])
      .then(([c, rs]) => { if (live) { setCols(c); setRows(Object.fromEntries(rs.map(r => [r.id, r]))) } })
      .catch(() => {})   // нет данных — карточки только с названием
    return () => { live = false }
  }, [field.link_table, key])
  if (!list.length && !editable) return <div id={id} className="fld-ro">—</div>
  return (
    <div className="link-field">
      {editable && (!single || !list.length) && (
        <button id={id} type="button" className="btn link-add" aria-label={`Добавить: ${field.title}`} onClick={() => setAdding(true)}><Icon name="plus" size={14} />Добавить</button>
      )}
      {adding && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onMouseDown={() => setAdding(false)} />
          <div className="link-pop">
            <LinkSearch field={field} exclude={list.map(v => v.id)} onClose={() => setAdding(false)}
              onPick={n => { if (single) setAdding(false); onChange([...list, { id: n.id, name: n.name }]) }}   // несколько — поиск открыт для следующей
              onCreate={async q => { const n = await createLinked(field, q); setAdding(false); onChange([...list, n]); openRecord(field.link_table, n.id) }} />
          </div>
        </>
      )}
      {list.length > 0 && (
        <div className="link-cards">{list.map(v => (
          <div key={v.id} className="link-card-wrap">
            <button type="button" className="link-card" title={v.name} onClick={() => onOpenLink?.(field.link_table, v.id)}>
              <span className="link-card-name">{v.name || `№${v.id}`}</span>
              <MiniFields cols={cols} row={rows[v.id]} />
            </button>
            {editable && <button type="button" className="link-card-x" aria-label={`Убрать ${v.name}`}
              onClick={() => onChange(list.filter(x => x.id !== v.id))}>×</button>}
          </div>
        ))}</div>
      )}
    </div>
  )
}

// Дата в карточке, как в Airtable: значение в формате поля, щелчок — календарь под полем.
// Выбор дня (у даты) или Enter — сохранить; щелчок мимо — сохранить введённое; Esc — отменить.
function DateField({ id, field, value, onChange }) {
  const [open, setOpen] = useState(false)
  const draft = useRef(value)
  const box = useRef(null)
  const done = v => { setOpen(false); if (v !== value) onChange(v) }
  useEffect(() => {
    if (!open) return
    draft.current = value
    const away = e => { if (!box.current?.contains(e.target)) done(draft.current) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className="dp-field" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}>
      <button id={id} type="button" className="fld-input dp-btn" aria-label={field.title} aria-expanded={open} onClick={() => setOpen(!open)}>
        {value ? displayValue(field, value) : <span style={{ color: 'var(--faint)' }}>—</span>}
      </button>
      {open && <div className="dp-pop"><DatePicker field={field} value={value} onChange={v => { draft.current = v }} onDone={done} /></div>}
    </div>
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

  // связанные записи (R11): мини-карточки, щелчок — переход к записи; правка — «+ Добавить» и «×»
  if (isLink(field)) {
    return wrap(<LinkField id={id} field={field} list={Array.isArray(value) ? value : []} onChange={onChange} onOpenLink={onOpenLink} />)
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
    // как в Airtable: выбранные плашки с крестиком, остальные варианты — в выпадающем списке
    const chosen = value ?? []
    const color = Object.fromEntries(choices.map(c => [c.name, c.color]))
    const rest = choices.filter(c => !chosen.includes(c.name))
    return wrap(
      <div className="fld-input fld-select fld-multi">
        {chosen.map(v => (
          <span key={v} className="fld-chip"><Pill name={v} color={color[v]} />
            <button type="button" className="fld-chip-x" aria-label={`Убрать ${v}`} onClick={() => onChange(chosen.filter(x => x !== v))}>×</button>
          </span>))}
        {!chosen.length && <span style={{ color: 'var(--faint)' }}>—</span>}
        <Icon name="caretDown" size={12} style={{ marginLeft: 'auto', color: 'var(--muted)' }} />
        <select id={id} aria-label={field.title} value="" onChange={e => e.target.value && onChange([...chosen, e.target.value])}>
          <option value="">Добавить…</option>
          {rest.map(c => <option key={c.id ?? c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>)
  }
  if (field.kind === 'date' || field.kind === 'dateTime') {
    return wrap(<DateField id={id} field={field} value={value} onChange={onChange} />)
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
