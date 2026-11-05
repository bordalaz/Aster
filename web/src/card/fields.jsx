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
// Стопка, как в Airtable: первые SHOWN карточек, остальное — «Показать все N» (окно со всеми, там же добавить).
// Порядок — как хранится; связи-события (link_events: перемещения, рейсы) хранятся старые→новые, как в Airtable
// (сервер ставит новую по дате события), а показываются свежими сверху. Карточку можно перетащить.
const SHOWN = 15

function LinkField({ id, field, list, onChange, onOpenLink }) {
  const [adding, setAdding] = useState(false)
  const [all, setAll] = useState(false)
  const [asking, setAsking] = useState(false)
  const [sortErr, setSortErr] = useState('')
  const editable = field.editable && field.link_table && onChange
  const single = !!field.options?.prefersSingleRecordLink
  if (!list.length && !editable) return <div id={id} className="fld-ro">—</div>
  const rev = !!field.link_events
  const view = rev ? [...list].reverse() : list   // как видно в карточке
  const put = v => onChange(rev ? [...v].reverse() : v)   // обратно в хранимый порядок
  // «По дате»: расставить по дате события — хранится старые→новые, без даты в конце; равные — как стояли
  const sortByDate = async () => {
    setAsking(false); setSortErr('')
    try {
      const dates = {}
      for (let i = 0; i < list.length; i += 500) {   // сервер отдаёт до 500 записей за раз
        const rows = await api(`/api/tables/${field.link_table}/records?ids=${list.slice(i, i + 500).map(v => v.id).join(',')}`)
        for (const r of rows) dates[r.id] = r[field.link_events] ?? null
      }
      const at = new Map(list.map((v, i) => [v.id, i]))
      const sorted = [...list].sort((x, y) => {
        const a = dates[x.id], b = dates[y.id]
        if ((a == null) !== (b == null)) return a == null ? 1 : -1
        return a == null || a === b ? at.get(x.id) - at.get(y.id) : a < b ? -1 : 1
      })
      if (sorted.some((v, i) => v.id !== list[i].id)) onChange(sorted)
    } catch { setSortErr('Не удалось расставить по дате') }
  }
  const askSort = () => (askOff(ASK_SORT) ? sortByDate() : setAsking(true))
  const tools = editable && (
    <div className="link-tools">
      {(!single || !list.length) && (
        <button id={id} type="button" className="btn link-add" aria-label={`Добавить: ${field.title}`} onClick={() => setAdding(true)}><Icon name="plus" size={14} />Добавить</button>
      )}
      {rev && list.length > 1 && (
        <button type="button" className="btn link-add" title="Расставить плашки по дате события" onClick={askSort}><Icon name="sort" size={14} />По дате</button>
      )}
    </div>
  )
  return (
    <div className="link-field">
      {tools}
      {sortErr && <div className="err" role="alert">{sortErr}</div>}
      {asking && <Ask title="Расставить по дате события?" yes="Да, расставить" no="Нет" storeKey={ASK_SORT}
        onYes={sortByDate} onNo={() => setAsking(false)}>
        Плашки встанут по дате события: самые свежие — сверху. Поля, которые берут последнее событие
        (например, «Местонахождение»), примут значение из верхней плашки.
      </Ask>}
      {adding && <LinkAdd field={field} list={list} single={single} onChange={onChange} onClose={() => setAdding(false)} />}
      <LinkCards field={field} list={view} shown={view.slice(0, SHOWN)} onChange={editable ? put : undefined} onOpenLink={onOpenLink} />
      {list.length > SHOWN && (
        <button type="button" className="link link-all" onClick={() => setAll(true)}>Показать все связанные записи ({list.length})</button>
      )}
      {all && (
        <div className="card-backdrop card-stacked" onMouseDown={e => { if (e.target === e.currentTarget) setAll(false) }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAll(false) } }}>
          <div className="card link-all-box" role="dialog" aria-modal="true" aria-label={field.title}>
            <header className="card-head">
              <span className="card-head-title">{field.title}</span>
              <button className="quiet" aria-label="Закрыть" autoFocus onClick={() => setAll(false)} style={{ marginLeft: 'auto' }}><Icon name="x" /></button>
            </header>
            <div className="link-all-body link-field">
              {tools}
              <LinkCards field={field} list={view} shown={view} onChange={editable ? put : undefined} onOpenLink={onOpenLink} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Поиск записи для связи; несколько — поиск открыт для следующей.
function LinkAdd({ field, list, single, onChange, onClose }) {
  return <>
    <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onMouseDown={onClose} />
    <div className="link-pop">
      <LinkSearch field={field} exclude={list.map(v => v.id)} onClose={onClose}
        onPick={n => { if (single) onClose(); onChange([...list, { id: n.id, name: n.name }]) }}
        onCreate={async q => { const n = await createLinked(field, q); onClose(); onChange([...list, n]); openRecord(field.link_table, n.id) }} />
    </div>
  </>
}

// Карточки связанных записей: поля мини-карточек — только показанных (не всех сотен).
// Перетаскивание, как в Airtable: карточка «поднимается» и едет за указателем, остальные плавно раздвигаются;
// отпустили — встаёт на место. Указателем, не HTML5 drag (тот в Firefox не тянет за кнопку).
const GAP = 6
function LinkCards({ field, list, shown, onChange, onOpenLink }) {
  const [cols, setCols] = useState([])
  const [rows, setRows] = useState({})
  const [drag, setDrag] = useState(null)   // {from, to, dy, h} — индексы в shown
  const moved = useRef(false)
  const box = useRef(null)
  const key = shown.map(v => v.id).join(',')
  useEffect(() => {
    if (!field.link_table || !key) return
    let live = true
    Promise.all([tableMeta(field.link_table), api(`/api/tables/${field.link_table}/records?ids=${key}`)])
      .then(([c, rs]) => { if (live) { setCols(c); setRows(r => ({ ...r, ...Object.fromEntries(rs.map(x => [x.id, x])) })) } })
      .catch(() => {})   // нет данных — карточки только с названием
    return () => { live = false }
  }, [field.link_table, key])

  const down = (e, from) => {
    if (!onChange || e.button > 0) return
    const rects = [...box.current.children].map(el => el.getBoundingClientRect())
    const y0 = e.clientY, x0 = e.clientX
    moved.current = false
    let cur = null
    const move = ev => {
      if (!moved.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      if (!moved.current) { moved.current = true; document.body.style.cursor = 'grabbing' }
      const dy = (ev.clientY ?? y0) - y0
      const r = rects[from], mid = r.top + r.height / 2 + dy
      // куда встанет: сколько других карточек выше её середины
      let to = 0
      rects.forEach((x, i) => { if (i !== from && x.top + x.height / 2 < mid) to++ })
      cur = { from, to, dy, h: r.height + GAP }
      setDrag(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      setDrag(null)
      if (moved.current && cur && cur.to !== cur.from) {
        const next = [...shown]
        const [it] = next.splice(cur.from, 1)
        next.splice(cur.to, 0, it)
        onChange([...next, ...list.slice(shown.length)])   // shown — начало list; остальное как было
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const shift = i => {
    if (!drag || i === drag.from) return 0
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.h
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.h
    return 0
  }
  if (!shown.length) return null
  return (
    <div className="link-cards" ref={box}>{shown.map((v, i) => {
      const lifted = drag?.from === i
      return (
        <div key={v.id} data-link-id={v.id} className={'link-card-wrap' + (onChange ? ' movable' : '') + (lifted ? ' lifted' : '')}
          style={drag ? { transform: `translateY(${lifted ? drag.dy : shift(i)}px)`, transition: lifted ? 'none' : undefined } : undefined}
          onPointerDown={e => down(e, i)}>
          <button type="button" className="link-card" title={v.name}
            onClick={() => { if (moved.current) { moved.current = false; return } onOpenLink?.(field.link_table, v.id) }}>
            <span className="link-card-name">{v.name || `№${v.id}`}</span>
            <MiniFields cols={cols} row={rows[v.id]} />
          </button>
          {onChange && <button type="button" className="link-card-x" aria-label={`Убрать ${v.name}`}
            onPointerDown={e => e.stopPropagation()} onClick={() => onChange(list.filter(x => x.id !== v.id))}>×</button>}
        </div>
      )
    })}</div>
  )
}

// Вопрос перед действием, как в хороших интерфейсах: «Да / Нет» и мелко «Больше не спрашивать».
// Отказ от вопроса помнится в браузере (aster.ask.*); вернуть — «Сбросить настройки» в меню профиля.
const ASK_SORT = 'aster.ask.sortLinks'
const askOff = k => { try { return localStorage.getItem(k) === 'off' } catch { return false } }
function Ask({ title, children, yes, no, storeKey, onYes, onNo }) {
  const [quiet, setQuiet] = useState(false)
  const ok = () => { if (quiet) try { localStorage.setItem(storeKey, 'off') } catch { /* приватный режим */ } onYes() }
  return (
    <div className="card-backdrop card-stacked" onMouseDown={e => { if (e.target === e.currentTarget) onNo() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onNo() } }}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{children}</p>
        <label className="ask-quiet"><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)} />Больше не спрашивать</label>
        <div className="send-foot">
          <button type="button" className="btn" onClick={onNo}>{no}</button>
          <button type="button" className="btn primary" autoFocus onClick={ok}>{yes}</button>
        </div>
      </div>
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
