import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dateParts, displayValue } from './cells.js'
import { lightColor } from './layout.js'
import { choiceColor, HUE_SHADES } from './renderers.js'
import { applyFilters, sortRows } from './viewConfig.js'
import { shiftDate } from './CalendarView.jsx'

// Таймлайн, как в Airtable: шкала по дням (Неделя / Месяц), полоса записи — точно от начала до конца
// (время учитывается), подпись — видимые поля со стилем. Без layout — строка на запись (слева названия,
// группы по полю выбора); layout='stacked' — записи плотно по дорожкам. Снизу «Всего» — число записей
// в каждый день, цвет по порогам. Перетаскивание полосы сдвигает начало и конец на целые дни.
// ponytail: масштабы только Неделя/Месяц; «+ Record», вехи, растягивание края полосы — когда попросят.

const PX = { week: 200, month: 41 }
const ROW = 34, HEAD = 36, LEFT = 240
const DAY = 86400000
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const dayNum = p => Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY)
const ymd = n => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() } }

// Точка на шкале (в днях от эпохи, с дробной частью — время в зоне поля).
export function point(field, value, isEnd) {
  const p = dateParts(field, value)
  if (!p) return null
  return dayNum(p) + (p.h == null ? (isEnd ? 1 : 0) : (p.h * 60 + p.mi) / 1440)
}

// Дорожки stacked: запись — на первую дорожку, где предыдущая уже кончилась.
export function stack(events) {
  const ends = []
  return events.map(e => {
    let lane = ends.findIndex(end => end <= e.t0)
    if (lane < 0) lane = ends.length
    ends[lane] = e.t1
    return lane
  })
}

// Цвет ячейки «Всего» по первому сработавшему порогу.
const CMP = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b, '!=': (a, b) => a !== b }
const SHADE = { Light: 0, Medium: 1, Dark: 2, Darker: 3 }
export function totalColor(rules, n) {
  const r = (rules ?? []).find(x => CMP[x.op]?.(n, Number(x.value)))
  const m = r && /^([a-z]+)(Light|Medium|Dark|Darker)?$/.exec(r.color)
  const hue = m && HUE_SHADES[m[1]]
  if (!hue) return null
  const shade = m[2] ? SHADE[m[2]] : 0
  return { background: hue[shade], color: shade >= 2 ? '#fff' : '#1d1f25' }
}

export default function TimelineView({ fields, rows, primaryField, config, search = '', onOpen, onMove }) {
  const byCol = useMemo(() => Object.fromEntries(fields.map(f => [f.column_name, f])), [fields])
  const startF = byCol[config.start], endF = byCol[config.end]
  const groupF = config.layout !== 'stacked' ? byCol[config.group?.[0]] : null
  const [scale, setScale] = useState('month')
  const px = PX[scale]
  const label = (config.columns ?? []).filter(c => byCol[c])

  const events = useMemo(() => {
    if (!startF) return []
    let rs = applyFilters(fields, rows, config.filters)
    if (config.sort?.length) rs = sortRows(rs, byCol, config.sort)
    const q = search.trim().toLowerCase()
    const out = []
    for (const row of rs) {
      const t0 = point(startF, row[config.start], false)
      if (t0 == null) continue
      const e = endF ? point(endF, row[config.end], true) : null
      const t1 = Math.max(e ?? t0 + 1, t0 + 1 / 24)
      const parts = label.map(c => ({ c, text: row[c] == null || row[c] === '' || (Array.isArray(row[c]) && !row[c].length) ? '(пусто)' : displayValue(byCol[c], row[c]) }))
      const text = parts.map(p => p.text).join(' · ')
      if (q && !text.toLowerCase().includes(q)) continue
      out.push({ row, t0, t1, parts, text, bg: lightColor(config.color, fields, row) ?? '#cfdfff' })
    }
    return out
  }, [fields, rows, byCol, startF, endF, config.start, config.end, config.filters, config.sort, config.color, search, label.join()])   // eslint-disable-line react-hooks/exhaustive-deps

  // Строки: stacked — дорожки; иначе группы (по вариантам, порядок поля или обратный) и строка на запись.
  const layout = useMemo(() => {
    const lines = []   // {kind:'group', value} | {kind:'row', ev} ; у stacked — {kind:'lane'}
    const placed = []  // {ev, line}
    if (config.layout === 'stacked') {
      stack(events).forEach((lane, i) => { placed.push({ ev: events[i], line: lane }) })
      const n = placed.reduce((m, p) => Math.max(m, p.line + 1), 0)
      for (let i = 0; i < n; i++) lines.push({ kind: 'lane' })
      return { lines, placed }
    }
    const buckets = new Map()
    if (groupF) {
      const names = (groupF.options?.choices ?? []).map(c => c.name)
      for (const v of [null, ...names]) buckets.set(v, [])
    } else buckets.set(undefined, [])
    for (const ev of events) {
      const v = groupF ? (ev.row[groupF.column_name] ?? null) : undefined
      if (!buckets.has(v)) buckets.set(v, [])
      buckets.get(v).push(ev)
    }
    let groups = [...buckets]
    if (config.groupDesc) groups = groups.reverse()
    for (const [value, evs] of groups) {
      if (groupF && config.hideEmpty && !evs.length) continue
      if (groupF) lines.push({ kind: 'group', value })
      for (const ev of evs) { placed.push({ ev, line: lines.length }); lines.push({ kind: 'row', ev }) }
    }
    return { lines, placed }
  }, [events, groupF, config.layout, config.groupDesc, config.hideEmpty])

  const now = new Date()
  const today = dayNum({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
  const lo = Math.floor(Math.min(today, ...events.map(e => e.t0))) - 14
  const hi = Math.ceil(Math.max(today, ...events.map(e => e.t1))) + 60
  const body = useRef(null)
  const [view, setView] = useState({ left: 0, width: 1200 })
  const [drag, setDrag] = useState(null)   // {ev, x0, dx}
  const left = groupF || config.layout !== 'stacked' ? LEFT : 0
  const tops = []
  let y = 0
  for (const l of layout.lines) { tops.push(y); y += l.kind === 'group' ? HEAD : ROW }

  const goto = day => { if (body.current) body.current.scrollLeft = Math.max(0, (day - lo) * px - (body.current.clientWidth - left) / 4) }
  useLayoutEffect(() => { goto(today) }, [px, lo])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = body.current
    if (!el) return
    const upd = () => setView({ left: el.scrollLeft, width: el.clientWidth ? el.clientWidth - left : 1200 })   // 0 — ещё не разложено
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd); ro.observe(el)
    return () => { el.removeEventListener('scroll', upd); ro.disconnect() }
  }, [left])

  if (!startF) return <p className="dash-empty">Поле даты таймлайна не найдено</p>
  const movable = !!onMove && startF.editable && (!endF || endF.editable)
  const ids = events.map(e => e.row.id)
  const d0 = lo + Math.max(0, Math.floor(view.left / px) - 1), d1 = Math.min(hi, lo + Math.ceil((view.left + view.width) / px) + 1)
  const days = []
  for (let d = d0; d <= d1; d++) days.push(d)
  const x = t => (t - lo) * px
  const shift = -view.left

  function down(e, ev) {
    if (e.button !== 0) return
    const x0 = e.clientX
    let dx = 0
    const move = m => { dx = m.clientX - x0; if (movable && Math.abs(dx) > 3) setDrag({ ev, dx }) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDrag(null)
      const delta = Math.round(dx / px)
      if (Math.abs(dx) <= 3) onOpen(ev.row, ids)
      else if (movable && delta) {
        const vals = { [config.start]: shiftDate(startF, ev.row[config.start], delta) }
        if (endF && ev.row[config.end] != null) vals[config.end] = shiftDate(endF, ev.row[config.end], delta)
        onMove(ev.row, vals)
      }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const totals = config.totals && days.map(d => events.reduce((n, e) => n + (e.t0 < d + 1 && e.t1 > d), 0))

  return (
    <section className="tl" aria-label="Таймлайн">
      <div className="tl-top">
        {left > 0 && <div className="tl-corner" style={{ width: left }}>{groupF && <>Сгруппировано по<br /><b>{groupF.title}</b></>}</div>}
        <div className="tl-scale">
          <div className="tl-months" style={{ transform: `translateX(${shift}px)` }}>
            {days.filter((d, i) => i === 1 || ymd(d).d === 1).map(d => (
              <span key={d} style={{ left: Math.max(x(d), view.left) + 8 }}>{MONTHS[ymd(d).m - 1]} {ymd(d).y}</span>
            ))}
          </div>
          <div className="tl-days" style={{ transform: `translateX(${shift}px)` }}>
            {days.map(d => { const p = ymd(d); return (
              <div key={d} className={`tl-dayh${d === today ? ' today' : ''}`} style={{ left: x(d), width: px }}>
                <span>{scale === 'week' ? `${WD[p.wd]} ${p.d}` : <>{WD[p.wd][0]}<br />{p.d}</>}</span>
              </div>) })}
          </div>
        </div>
        <div className="tl-ctl">
          <button type="button" className="tool" onClick={() => goto(today)}>Сегодня</button>
          <select className="tool" aria-label="Масштаб" value={scale} onChange={e => setScale(e.target.value)}>
            <option value="week">Неделя</option><option value="month">Месяц</option>
          </select>
          <button type="button" className="tool" aria-label="Назад" onClick={() => body.current && (body.current.scrollLeft -= view.width * 0.8)}>‹</button>
          <button type="button" className="tool" aria-label="Вперёд" onClick={() => body.current && (body.current.scrollLeft += view.width * 0.8)}>›</button>
        </div>
      </div>
      <div className="tl-body" ref={body}>
        <div style={{ width: left + (hi - lo + 1) * px, height: Math.max(y, 1), position: 'relative' }}>
          <div className="tl-grid" style={{ left: left + x(d0), width: (d1 - d0 + 1) * px, height: y, backgroundSize: `${px}px 100%` }} />
          {today >= d0 && today <= d1 && <div className="tl-now" style={{ left: left + x(today) + px / 2, height: y }} />}
          {left > 0 && layout.lines.map((l, i) => (
            <div key={i} className={`tl-left ${l.kind}`} style={{ top: tops[i], left: view.left, width: left, height: l.kind === 'group' ? HEAD : ROW }}>
              {l.kind === 'group'
                ? <span className="pill" style={{ background: choiceColor(groupF.options?.choices?.find(c => c.name === l.value)?.color).bg, borderRadius: 999 }}>{l.value ?? 'Пусто'}</span>
                : <button type="button" className="tl-name" onClick={() => onOpen(l.ev.row, ids)}>{displayValue(byCol[primaryField], l.ev.row[primaryField])}</button>}
            </div>
          ))}
          {layout.lines.map((l, i) => l.kind === 'group' && <div key={'g' + i} className="tl-grouprow" style={{ top: tops[i], left, width: (hi - lo + 1) * px }} />)}
          {layout.placed.filter(p => p.ev.t1 > d0 && p.ev.t0 < d1 + 1).map(({ ev, line }) => (
            <div key={ev.row.id} data-id={ev.row.id} role="button" tabIndex={0} className={`tl-bar${drag?.ev === ev ? ' dragging' : ''}`} title={ev.text}
              style={{ top: tops[line] + 4, left: left + x(ev.t0) + (drag?.ev === ev ? drag.dx : 0), width: Math.max(6, (ev.t1 - ev.t0) * px), background: ev.bg, cursor: movable ? 'grab' : 'pointer' }}
              onPointerDown={e => down(e, ev)} onKeyDown={e => e.key === 'Enter' && onOpen(ev.row, ids)}>
              {ev.parts.map((p, k) => {
                const st = config.labelStyle?.[p.c] ?? {}
                return <span key={p.c} className={p.text === '(пусто)' ? 'tl-empty' : ''} style={{ fontWeight: st.bold ? 600 : undefined, fontStyle: st.italic ? 'italic' : undefined, textDecoration: st.underline ? 'underline' : undefined }}>{k ? ' · ' : ''}{p.text}</span>
              })}
            </div>
          ))}
        </div>
      </div>
      {totals && (
        <div className="tl-totals">
          <div className="tl-corner" style={{ width: Math.max(left, 60) }}>{config.totals.label}</div>
          <div className="tl-scale">
            <div style={{ transform: `translateX(${shift - Math.max(0, 60 - left)}px)`, position: 'relative', height: '100%' }}>
              {days.map((d, i) => <div key={d} className="tl-tot" style={{ left: x(d), width: px, ...totalColor(config.totals.rules, totals[i]) }}>{totals[i]}</div>)}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
