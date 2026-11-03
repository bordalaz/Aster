import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dateParts, displayValue, hasTime, partsToValue } from './cells.js'
import { lightColor } from './layout.js'
import { applyFilters, sortRows } from './viewConfig.js'
import { Icon } from '../ui/icons.jsx'
import { useStored } from '../ui/useStored.js'

// Календарь, как в Airtable. Режимы: Месяц (6 недель) и 2 недели — сетка дней с полосами записей;
// Неделя / 3 дня / День — у даты со временем сетка по часам (запись режется по дням, пересекающиеся —
// рядом), у даты без времени — полосы в одну строку. Выходные: показывать / свернуть / скрыть.
// Полоса — от начала (config.start) до конца (config.end), со временем начала и подписью «поле · поле».
// Не влезли — «+N ещё» → попап дня. Перетаскивание сдвигает начало и конец на те же дни.
// Режим и выходные помнятся в браузере для каждого вида (storeKey). ponytail: «Custom» и «Start week on» Airtable — нет.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const MODES = [['day', 'День'], ['3day', '3 дня'], ['week', 'Неделя'], ['2week', '2 недели'], ['month', 'Месяц']]
const LANES = { month: 3, '2week': 8 }   // полос в ячейке, остальное — «+N ещё»; в одну строку — все
const HOUR = 44                          // высота часа в сетке по часам
const DAY = 86400000
const dayNum = p => Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY)
const fromNum = n => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() } }
const wday = n => (new Date(n * DAY).getUTCDay() + 6) % 7   // 0 — понедельник
const monday = n => n - wday(n)
const pad2 = n => String(n).padStart(2, '0')
const empty = v => v == null || v === '' || v === false || (Array.isArray(v) && !v.length)   // Airtable пустое в подписи пропускает

// Сдвиг значения даты на delta дней (время и зона поля сохраняются).
export function shiftDate(field, value, delta) {
  const p = dateParts(field, value)
  return p ? partsToValue(field, { ...p, ...fromNum(dayNum(p) + delta) }) : value
}

// Первые дни 6 недель сетки месяца (номера дней от эпохи).
export function monthGrid(y, m) {
  const start = monday(dayNum({ y, m, d: 1 }))
  return Array.from({ length: 6 }, (_, i) => start + i * 7)
}

// Строки сетки и дни в строке для режима: [[первый день, число дней], …].
export function rowsFor(mode, anchor) {
  if (mode === 'month') { const { y, m } = fromNum(anchor); return monthGrid(y, m).map(ws => [ws, 7]) }
  if (mode === '2week') { const ws = monday(anchor); return [[ws, 7], [ws + 7, 7]] }
  if (mode === 'week') return [[monday(anchor), 7]]
  return [[anchor, mode === '3day' ? 3 : 1]]
}

// Полосы одной строки: события, задевающие [ws, ws+n-1], по дорожкам — раньше начало, длиннее — выше.
export function placeWeek(events, ws, n = 7) {
  const evs = events.filter(e => e.s <= ws + n - 1 && e.e >= ws)
    .sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s) || a.row.id - b.row.id)
  const ends = []
  return evs.map(e => {
    let lane = ends.findIndex(end => end < Math.max(e.s, ws))
    if (lane < 0) lane = ends.length
    ends[lane] = Math.min(e.e, ws + n - 1)
    return { ...e, lane, from: Math.max(e.s, ws) - ws, to: Math.min(e.e, ws + n - 1) - ws }
  })
}

// Сетка по часам: куски записей в день day (доли суток 0…1), пересекающиеся — на соседних дорожках.
export function daySlices(events, day) {
  const out = events.filter(e => e.t0 < day + 1 && e.t1 > day)
    .map(e => ({ ...e, a: Math.max(e.t0, day) - day, b: Math.min(e.t1, day + 1) - day }))
    .sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a) || x.row.id - y.row.id)
  const ends = []
  for (const s of out) {
    let lane = ends.findIndex(end => end <= s.a)
    if (lane < 0) lane = ends.length
    ends[lane] = s.b; s.lane = lane
  }
  // ponytail: ширина — по числу дорожек за весь день, не по группе пересечений
  for (const s of out) s.lanes = ends.length
  return out
}

// Заголовок периода: «Ноябрь 2026», «2 – 8 ноября 2026», «3 ноября 2026».
export function periodTitle(mode, first, last) {
  const a = fromNum(first), b = fromNum(last)
  if (mode === 'month') return null
  if (first === last) return `${a.d} ${MONTHS_GEN[a.m - 1]} ${a.y}`
  const left = a.m === b.m ? `${a.d}` : a.y === b.y ? `${a.d} ${MONTHS_GEN[a.m - 1]}` : `${a.d} ${MONTHS_GEN[a.m - 1]} ${a.y}`
  return `${left} – ${b.d} ${MONTHS_GEN[b.m - 1]} ${b.y}`
}

export default function CalendarView({ fields, rows, primaryField, config, search = '', onOpen, onMove, storeKey }) {
  const byCol = useMemo(() => Object.fromEntries(fields.map(f => [f.column_name, f])), [fields])
  const startF = byCol[config.start], endF = byCol[config.end]
  const timed = !!startF && hasTime(startF)
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
      // точные концы для сетки по часам: время в долях суток; без конца — час
      const t0 = s + (sp.h != null ? (sp.h * 60 + sp.mi) / 1440 : 0)
      const t1 = Math.max(t0 + 1 / 48, ep ? dayNum(ep) + (ep.h != null ? (ep.h * 60 + ep.mi) / 1440 : 1) : t0 + 1 / 24)
      const text = label.filter(c => !empty(row[c])).map(c => displayValue(byCol[c], row[c])).filter(t => t && t !== '—').join(' · ') || `Запись №${row.id}`
      if (q && !text.toLowerCase().includes(q)) continue
      out.push({ row, s, e, t0, t1, text, time: hasTime(startF) && sp.h != null ? `${pad2(sp.h)}:${pad2(sp.mi)}` : null,
        bg: lightColor(config.color, fields, row) ?? '#e9eef6' })
    }
    return out
  }, [fields, rows, byCol, startF, endF, config.start, config.end, config.filters, config.sort, config.color, search, label.join()])   // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date()
  const today = dayNum({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
  const [mode, setMode] = useStored(storeKey && `${storeKey}.mode`, 'month', MODES.map(m => m[0]))
  const [weekends, setWeekends] = useStored(storeKey && `${storeKey}.weekends`, 'show', ['show', 'collapse', 'hide'])
  const [anchor, setAnchor] = useState(today)
  const [popDay, setPopDay] = useState(null)
  const [drag, setDrag] = useState(null)   // {row, grab, over}
  const pop = useRef(null)
  const hours = useRef(null)
  useEffect(() => {
    if (popDay == null) return
    const key = e => e.key === 'Escape' && setPopDay(null)
    const click = e => pop.current && !pop.current.contains(e.target) && setPopDay(null)
    document.addEventListener('keydown', key); document.addEventListener('mousedown', click)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click) }
  }, [popDay])
  const hourGrid = timed && ['week', '3day', 'day'].includes(mode)
  useLayoutEffect(() => { if (hourGrid && hours.current) hours.current.scrollTop = 7 * HOUR }, [hourGrid, mode])

  if (!startF) return <p className="dash-empty">Поле даты календаря не найдено</p>
  const movable = !!onMove && startF.editable && (!endF || endF.editable)
  const ids = events.map(e => e.row.id)
  const grid = rowsFor(mode, anchor)
  const firstDay = grid[0][0], lastDay = grid.at(-1)[0] + grid.at(-1)[1] - 1
  const { y: ay, m: am } = fromNum(anchor)
  const monthFirst = dayNum({ y: ay, m: am, d: 1 }), monthLast = dayNum({ y: am === 12 ? ay + 1 : ay, m: am % 12 + 1, d: 1 }) - 1
  const step = d => {
    setPopDay(null)
    if (mode === 'month') { const t = am + d; setAnchor(dayNum({ y: ay + Math.floor((t - 1) / 12), m: ((t - 1) % 12 + 12) % 12 + 1, d: 1 })) }
    else setAnchor(a => a + d * { '2week': 14, week: 7, '3day': 3, day: 1 }[mode])
  }
  // ширины колонок: выходные в 7-дневных строках можно свернуть или скрыть
  const weights = n => Array.from({ length: n }, (_, i) => (n === 7 && i > 4 ? { show: 1, collapse: 0.25, hide: 0 }[weekends] : 1))
  const pos = n => { const w = weights(n), sum = w.reduce((a, b) => a + b, 0); let acc = 0; return w.map(x => { const l = acc; acc += x; return [l / sum * 100, x / sum * 100] }) }
  const cols = n => weights(n).map(w => (w ? `minmax(0, ${w}fr)` : '0')).join(' ')
  const lanes = LANES[mode] ?? Infinity

  function drop(day) {
    const d = drag; setDrag(null)
    if (!d || day === d.grab) return
    const delta = day - d.grab, vals = { [config.start]: shiftDate(startF, d.row[config.start], delta) }
    if (endF && d.row[config.end] != null) vals[config.end] = shiftDate(endF, d.row[config.end], delta)
    onMove(d.row, vals)
  }
  const dragStart = (e, ev, grabOf) => {
    ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(e.row.id))
    setDrag({ row: e.row, grab: grabOf(ev), over: null })
  }
  const dropTarget = day => (movable ? {
    onDragOver: ev => { ev.preventDefault(); if (drag && drag.over !== day) setDrag(x => ({ ...x, over: day })) },
    onDrop: ev => { ev.preventDefault(); drop(day) },
  } : {})
  const bar = (e, extra = {}) => (
    <button key={e.row.id} data-id={e.row.id} type="button" className={`cal-bar${e.s < (extra.ws ?? e.s) ? ' cont-l' : ''}${e.e > (extra.we ?? e.e) ? ' cont-r' : ''}`}
      style={{ background: e.bg, ...extra.style }} title={e.text}
      draggable={movable || undefined}
      onDragStart={movable ? ev => dragStart(e, ev, x => {
        const r = x.currentTarget.closest('.cal-week')?.getBoundingClientRect()
        if (!r || extra.ws == null) return e.s
        const p = extra.pos, rel = (x.clientX - r.left) / r.width * 100
        return extra.ws + Math.max(0, p.findLastIndex(([l]) => l <= rel))
      }) : undefined}
      onDragEnd={() => setDrag(null)}
      onClick={() => onOpen(e.row, ids)}>
      {e.time && (extra.ws == null || e.s >= extra.ws) && <span className="cal-time">{e.time}</span>}{e.text}
    </button>
  )
  const head = days => (
    <div className="cal-wd" style={{ gridTemplateColumns: hourGrid ? `48px ${cols(days.length)}` : cols(days.length) }}>
      {hourGrid && <div />}
      {days.map((d, i) => (
        <div key={d} className={wday(d) > 4 ? 'we' : ''} style={{ overflow: 'hidden' }}>
          {WEEKDAYS[wday(d)]}{mode !== 'month' && mode !== '2week' && <> <span className={d === today ? 'cal-wd-today' : ''}>{fromNum(d).d}</span></>}
        </div>
      ))}
    </div>
  )
  const span = (ws, n) => Array.from({ length: n }, (_, i) => ws + i)

  return (
    <section className="cal" aria-label="Календарь">
      <header className="cal-head">
        <h2>{mode === 'month' ? <>{MONTHS[am - 1]} <span>{ay}</span></> : periodTitle(mode, firstDay, lastDay)}</h2>
        <button type="button" className="tool" aria-label="Назад" onClick={() => step(-1)}><Icon name="arrowLeft" size={14} /></button>
        <button type="button" className="tool" aria-label="Вперёд" onClick={() => step(1)}><Icon name="arrowLeft" size={14} style={{ transform: 'scaleX(-1)' }} /></button>
        <button type="button" className="tool" onClick={() => { setPopDay(null); setAnchor(today) }}>Сегодня</button>
        <select className="tool" aria-label="Режим" value={mode} onChange={e => { setPopDay(null); setMode(e.target.value) }}>
          {MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <select className="tool" aria-label="Выходные" value={weekends} onChange={e => setWeekends(e.target.value)}>
          <option value="show">Выходные: показывать</option><option value="collapse">Выходные: свернуть</option><option value="hide">Выходные: скрыть</option>
        </select>
      </header>
      {hourGrid ? (() => {
        const [[ws, n]] = grid, days = span(ws, n), p = pos(n), nowFrac = (now.getHours() * 60 + now.getMinutes()) / 1440
        return (
          <>
            {head(days)}
            <div className="cal-hours" ref={hours}>
              <div className="cal-hgrid" style={{ gridTemplateColumns: `48px ${cols(n)}`, height: 24 * HOUR }}>
                <div className="cal-hlabels">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR }}>{pad2(h)}:00</span>)}</div>
                {days.map((d, i) => (
                  <div key={d} className={`cal-hday${wday(d) > 4 ? ' we' : ''}${drag?.over === d ? ' over' : ''}`} style={{ backgroundSize: `100% ${HOUR}px` }} {...dropTarget(d)}>
                    {p[i][1] > 0 && daySlices(events, d).map(s => (
                      <button key={s.row.id} data-id={s.row.id} type="button" className="cal-slot" title={s.text}
                        style={{ top: s.a * 24 * HOUR, height: Math.max(18, (s.b - s.a) * 24 * HOUR - 2), left: `calc(${s.lane} * 100% / ${s.lanes} + 2px)`,
                          width: `calc(100% / ${s.lanes} - 4px)`, background: s.bg }}
                        draggable={movable || undefined}
                        onDragStart={movable ? ev => dragStart(s, ev, () => d) : undefined} onDragEnd={() => setDrag(null)}
                        onClick={() => onOpen(s.row, ids)}>
                        {s.t0 >= d && s.time && <span className="cal-time">{s.time}</span>}{s.text}
                      </button>
                    ))}
                    {d === today && <div className="cal-now" style={{ top: nowFrac * 24 * HOUR }} />}
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      })() : (
        <>
          {head(span(grid[0][0], grid[0][1]))}
          <div className="cal-body" style={{ gridTemplateRows: `repeat(${grid.length}, minmax(110px, 1fr))` }}>
            {grid.map(([ws, n]) => {
              const placed = placeWeek(events, ws, n), p = pos(n)
              return (
                <div key={ws} className="cal-week" style={{ gridTemplateColumns: cols(n),
                  minHeight: lanes === Infinity ? 34 + placed.reduce((m, x) => Math.max(m, x.lane + 1), 0) * 22 : undefined }}>
                  {span(ws, n).map((day, i) => {
                    const { d } = fromNum(day)
                    const more = placed.filter(x => x.lane >= lanes && x.from <= i && x.to >= i).length
                    return (
                      <div key={i} className={`cal-day${wday(day) > 4 ? ' we' : ''}${mode === 'month' && (day < monthFirst || day > monthLast) ? ' out' : ''}${drag?.over === day ? ' over' : ''}`}
                        style={p[i][1] ? undefined : { borderRight: 0 }} {...dropTarget(day)}>
                        {p[i][1] > 0 && <span className={`cal-num${day === today ? ' today' : ''}`}>{d}</span>}
                        {more > 0 && p[i][1] > 0 && <button type="button" className="cal-more" style={{ top: 26 + lanes * 22 }} onClick={() => setPopDay(day)}>+{more} ещё</button>}
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
                  {placed.filter(x => x.lane < lanes).map(x => {
                    const l = p[x.from][0], r = p[x.to][0] + p[x.to][1]
                    return r - l > 0 && bar(x, { ws, we: ws + n - 1, pos: p, style: {
                      position: 'absolute', top: 26 + x.lane * 22, left: `calc(${l}% + 4px)`, width: `calc(${r - l}% - 8px)` } })
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
