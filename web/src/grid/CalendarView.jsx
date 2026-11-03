import { useEffect, useMemo, useRef, useState } from 'react'
import { dateParts, displayValue, hasTime, partsToValue } from './cells.js'
import { lightColor } from './layout.js'
import { applyFilters, sortRows } from './viewConfig.js'
import { Icon } from '../ui/icons.jsx'

// Календарь (месяц), как в Airtable: неделя с понедельника, 6 недель, выходные серым. Запись — полоса
// от дня начала (config.start) до дня конца (config.end), со временем начала и подписью «поле · поле».
// Не влезли — «+N ещё» → попап дня. Перетаскивание полосы сдвигает начало и конец на те же дни.
// ponytail: только режим «Месяц»; День/Неделя/2 недели и «See records» (записи без даты) — когда попросят.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const LANES = 3          // полос в ячейке, остальное — «+N ещё»
const DAY = 86400000
const dayNum = p => Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY)
const fromNum = n => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() } }
const pad2 = n => String(n).padStart(2, '0')
const empty = v => v == null || v === '' || v === false || (Array.isArray(v) && !v.length)   // Airtable пустое в подписи пропускает

// Сдвиг значения даты на delta дней (время и зона поля сохраняются).
export function shiftDate(field, value, delta) {
  const p = dateParts(field, value)
  return p ? partsToValue(field, { ...p, ...fromNum(dayNum(p) + delta) }) : value
}

// Первые дни 6 недель сетки месяца (номера дней от эпохи).
export function monthGrid(y, m) {
  const first = dayNum({ y, m, d: 1 })
  const start = first - (new Date(first * DAY).getUTCDay() + 6) % 7
  return Array.from({ length: 6 }, (_, i) => start + i * 7)
}

// Полосы одной недели: события, задевающие [ws, ws+6], по дорожкам — раньше начало, длиннее — выше.
export function placeWeek(events, ws) {
  const evs = events.filter(e => e.s <= ws + 6 && e.e >= ws)
    .sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s) || a.row.id - b.row.id)
  const ends = []
  return evs.map(e => {
    let lane = ends.findIndex(end => end < Math.max(e.s, ws))
    if (lane < 0) lane = ends.length
    ends[lane] = Math.min(e.e, ws + 6)
    return { ...e, lane, from: Math.max(e.s, ws) - ws, to: Math.min(e.e, ws + 6) - ws }
  })
}

export default function CalendarView({ fields, rows, primaryField, config, search = '', onOpen, onMove }) {
  const byCol = useMemo(() => Object.fromEntries(fields.map(f => [f.column_name, f])), [fields])
  const startF = byCol[config.start], endF = byCol[config.end]
  const label = [primaryField, ...(config.columns ?? []).filter(c => c !== primaryField)].filter(c => byCol[c])
  const events = useMemo(() => {
    if (!startF) return []
    let rs = applyFilters(fields, rows, config.filters)
    if (config.sort?.length) rs = sortRows(rs, byCol, config.sort)
    const q = search.trim().toLowerCase()
    const out = []
    for (const row of rs) {
      const sp = dateParts(startF, row[config.start])
      if (!sp) continue
      const ep = endF ? dateParts(endF, row[config.end]) : null
      const s = dayNum(sp), e = Math.max(s, ep ? dayNum(ep) : s)
      const text = label.filter(c => !empty(row[c])).map(c => displayValue(byCol[c], row[c])).filter(t => t && t !== '—').join(' · ') || `Запись №${row.id}`
      if (q && !text.toLowerCase().includes(q)) continue
      out.push({ row, s, e, text, time: hasTime(startF) && sp.h != null ? `${pad2(sp.h)}:${pad2(sp.mi)}` : null,
        bg: lightColor(config.color, fields, row) ?? '#e9eef6' })
    }
    return out
  }, [fields, rows, byCol, startF, endF, config.start, config.end, config.filters, config.sort, config.color, search, label.join()])   // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date()
  const today = dayNum({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [popDay, setPopDay] = useState(null)
  const [drag, setDrag] = useState(null)   // {row, grab, over}
  const pop = useRef(null)
  useEffect(() => {
    if (popDay == null) return
    const key = e => e.key === 'Escape' && setPopDay(null)
    const click = e => pop.current && !pop.current.contains(e.target) && setPopDay(null)
    document.addEventListener('keydown', key); document.addEventListener('mousedown', click)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click) }
  }, [popDay])

  if (!startF) return <p className="dash-empty">Поле даты календаря не найдено</p>
  const movable = !!onMove && startF.editable && (!endF || endF.editable)
  const ids = events.map(e => e.row.id)
  const step = d => { setPopDay(null); setYm(({ y, m }) => { const t = m + d; return { y: y + Math.floor((t - 1) / 12), m: ((t - 1) % 12 + 12) % 12 + 1 } }) }
  const first = dayNum({ ...ym, d: 1 }), last = dayNum({ y: ym.m === 12 ? ym.y + 1 : ym.y, m: ym.m % 12 + 1, d: 1 }) - 1

  function drop(day) {
    const d = drag; setDrag(null)
    if (!d || day === d.grab) return
    const delta = day - d.grab, vals = { [config.start]: shiftDate(startF, d.row[config.start], delta) }
    if (endF && d.row[config.end] != null) vals[config.end] = shiftDate(endF, d.row[config.end], delta)
    onMove(d.row, vals)
  }
  const bar = (e, extra = {}) => (
    <button key={e.row.id} data-id={e.row.id} type="button" className={`cal-bar${e.s < (extra.ws ?? e.s) ? ' cont-l' : ''}${e.e > (extra.ws ?? e.e) + 6 ? ' cont-r' : ''}`}
      style={{ background: e.bg, ...extra.style }} title={e.text}
      draggable={movable || undefined}
      onDragStart={movable ? ev => {
        ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(e.row.id))
        const r = ev.currentTarget.closest('.cal-week')?.getBoundingClientRect()
        const grab = r && extra.ws != null ? extra.ws + Math.min(6, Math.max(0, Math.floor((ev.clientX - r.left) / (r.width / 7)))) : e.s
        setDrag({ row: e.row, grab, over: null })
      } : undefined}
      onDragEnd={() => setDrag(null)}
      onClick={() => onOpen(e.row, ids)}>
      {e.time && (extra.ws == null || e.s >= extra.ws) && <span className="cal-time">{e.time}</span>}{e.text}
    </button>
  )

  return (
    <section className="cal" aria-label="Календарь">
      <header className="cal-head">
        <h2>{MONTHS[ym.m - 1]} <span>{ym.y}</span></h2>
        <button type="button" className="tool" aria-label="Предыдущий месяц" onClick={() => step(-1)}><Icon name="arrowLeft" size={14} /></button>
        <button type="button" className="tool" aria-label="Следующий месяц" onClick={() => step(1)}><Icon name="arrowLeft" size={14} style={{ transform: 'scaleX(-1)' }} /></button>
        <button type="button" className="tool" onClick={() => { setPopDay(null); setYm({ y: now.getFullYear(), m: now.getMonth() + 1 }) }}>Сегодня</button>
      </header>
      <div className="cal-wd">{WEEKDAYS.map((w, i) => <div key={w} className={i > 4 ? 'we' : ''}>{w}</div>)}</div>
      <div className="cal-body">
        {monthGrid(ym.y, ym.m).map(ws => {
          const placed = placeWeek(events, ws)
          return (
            <div key={ws} className="cal-week">
              {Array.from({ length: 7 }, (_, i) => {
                const day = ws + i, { d } = fromNum(day)
                const more = placed.filter(p => p.lane >= LANES && p.from <= i && p.to >= i).length
                return (
                  <div key={i} className={`cal-day${i > 4 ? ' we' : ''}${day < first || day > last ? ' out' : ''}${drag?.over === day ? ' over' : ''}`}
                    onDragOver={movable ? ev => { ev.preventDefault(); if (drag && drag.over !== day) setDrag(x => ({ ...x, over: day })) } : undefined}
                    onDrop={movable ? ev => { ev.preventDefault(); drop(day) } : undefined}>
                    <span className={`cal-num${day === today ? ' today' : ''}`}>{d}</span>
                    {more > 0 && <button type="button" className="cal-more" style={{ top: 26 + LANES * 22 }} onClick={() => setPopDay(day)}>+{more} ещё</button>}
                    {popDay === day && (
                      <div ref={pop} className="cal-pop" role="dialog" aria-label={`${d} ${MONTHS_GEN[fromNum(day).m - 1]}`}>
                        <div className="cal-pop-head">{d} {MONTHS_GEN[fromNum(day).m - 1]}
                          <button type="button" aria-label="Закрыть" onClick={() => setPopDay(null)}><Icon name="x" size={14} /></button></div>
                        {events.filter(e => e.s <= day && e.e >= day).map(e => bar(e))}
                      </div>
                    )}
                  </div>
                )
              })}
              {placed.filter(p => p.lane < LANES).map(p => bar(p, { ws, style: {
                position: 'absolute', top: 26 + p.lane * 22, left: `calc(${p.from} * 100% / 7 + 4px)`, width: `calc(${p.to - p.from + 1} * 100% / 7 - 8px)` } }))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
