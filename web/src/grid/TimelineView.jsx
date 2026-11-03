import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dateParts, displayValue } from './cells.js'
import { lightColor } from './layout.js'
import { choiceColor, HUE_SHADES } from './renderers.js'
import { applyFilters, sortRows } from './viewConfig.js'
import { shiftDate } from './CalendarView.jsx'
import { useStored } from '../ui/useStored.js'

// Таймлайн, как в Airtable: масштаб (День … Год) вписывает отрезок в ширину экрана, полоса записи — точно от начала до конца
// (время учитывается), подпись — видимые поля со стилем. Без layout — строка на запись (слева названия,
// группы по полю выбора); layout='stacked' — записи плотно по дорожкам. Снизу «Всего» — число записей
// в каждый день, цвет по порогам. Перетаскивание полосы сдвигает начало и конец на целые дни.
// Перетаскивание: в «Дне» — шаг час, в остальных масштабах — целые дни. ponytail: «+ Record», вехи, растягивание края полосы — когда попросят.
// Gantt (расширение Airtable): config.deps — связь на ту же таблицу «после чего идёт». Стрелка от конца
// предшественника к началу записи; красная — запись начинается раньше, чем кончился предшественник.
// ponytail: зависимые при перетаскивании не сдвигаются — подсветка конфликта красным; автосдвиг — когда попросят.

export const SCALES = [['day', 'День'], ['week', 'Неделя'], ['2week', '2 недели'], ['month', 'Месяц'], ['quarter', 'Квартал'], ['6month', '6 месяцев'], ['year', 'Год']]
const SPAN = { day: 1, week: 7, '2week': 14, month: 31, quarter: 91, '6month': 182, year: 365 }   // дней на ширину экрана
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MON = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const pad2 = n => String(n).padStart(2, '0')
const ROW = 34, HEAD = 36, LEFT = 240
const DAY = 86400000
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const dayNum = p => Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY)
const ymd = n => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() } }
const monthOf = (n, k = 0) => { const p = ymd(n), t = p.m - 1 + k; return dayNum({ y: p.y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 + 1, d: 1 }) }

// Деления шкалы на [d0, d1]: верхняя строка (день / месяц / квартал) и нижняя (часы / дни / недели / месяцы).
export function ticks(scale, d0, d1) {
  const top = [], bottom = []
  const each = (first, next, label, out) => { for (let a = first; a <= d1 + 1; a = next(a)) out.push({ a, b: next(a), label: label(a) }) }
  if (scale === 'day') {
    each(d0, a => a + 1, a => { const p = ymd(a); return `${p.d} ${MONTHS_GEN[p.m - 1]} ${p.y}` }, top)
    for (let d = d0; d <= d1; d++) for (let h = 0; h < 24; h++) bottom.push({ a: d + h / 24, b: d + (h + 1) / 24, label: `${pad2(h)}:00` })
  } else if (['week', '2week', 'month', 'quarter'].includes(scale)) {
    each(monthOf(d0), a => monthOf(a, 1), a => `${MONTHS[ymd(a).m - 1]} ${ymd(a).y}`, top)
    if (scale === 'quarter') each(d0 - (ymd(d0).wd + 6) % 7, a => a + 7, a => String(ymd(a).d), bottom)   // недели с понедельника
    else each(d0, a => a + 1, a => { const p = ymd(a); return scale === 'month' ? [WD[p.wd][0], p.d] : `${WD[p.wd]} ${p.d}` }, bottom)
  } else {
    const q = n => { const p = ymd(n); return dayNum({ y: p.y, m: Math.floor((p.m - 1) / 3) * 3 + 1, d: 1 }) }
    each(q(d0), a => monthOf(a, 3), a => `${Math.floor((ymd(a).m - 1) / 3) + 1} кв. ${ymd(a).y}`, top)
    each(monthOf(d0), a => monthOf(a, 1), a => MON[ymd(a).m - 1], bottom)
  }
  return { top, bottom }
}

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

// Стрелки Gantt: пары {from, to} размещённых записей, late — нарушен порядок. Связи на записи вне вида — пропускаем.
export function depLinks(placed, deps) {
  if (!deps) return []
  const byId = new Map(placed.map(p => [p.ev.row.id, p]))
  const out = []
  for (const to of placed) for (const l of Array.isArray(to.ev.row[deps]) ? to.ev.row[deps] : []) {
    const from = byId.get(l?.id)
    if (from && from !== to) out.push({ from, to, late: from.ev.t1 > to.ev.t0 + 1e-9 })
  }
  return out
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

export default function TimelineView({ fields, rows, primaryField, config, search = '', onOpen, onMove, storeKey }) {
  const byCol = useMemo(() => Object.fromEntries(fields.map(f => [f.column_name, f])), [fields])
  const startF = byCol[config.start], endF = byCol[config.end]
  const groupF = config.layout !== 'stacked' ? byCol[config.group?.[0]] : null
  const [scale, setScale] = useStored(storeKey && `${storeKey}.scale`, 'month', SCALES.map(s => s[0]))   // помнится для вида
  const [px, setPx] = useState(41)
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
  // запас по краям — не меньше экрана масштаба, чтобы «Год» и «6 месяцев» не обрывались
  const lo = Math.floor(Math.min(today, ...events.map(e => e.t0))) - Math.max(14, SPAN[scale])
  const hi = Math.ceil(Math.max(today, ...events.map(e => e.t1))) + Math.max(60, SPAN[scale])
  const body = useRef(null)
  const [view, setView] = useState({ left: 0, width: 1200 })
  const [drag, setDrag] = useState(null)   // {ev, x0, dx}
  const left = groupF || config.layout !== 'stacked' ? LEFT : 0
  const tops = []
  let y = 0
  for (const l of layout.lines) { tops.push(y); y += l.kind === 'group' ? HEAD : ROW }

  // масштаб: выбранный отрезок — во всю ширину экрана (пересчёт при смене масштаба, не при каждом ресайзе)
  useLayoutEffect(() => { const w = body.current?.clientWidth ? body.current.clientWidth - left : 1200; setPx(Math.max(0.5, w / SPAN[scale])) }, [scale, left])
  const goto = day => {
    const el = body.current
    if (!el) return
    el.scrollLeft = Math.max(0, (day - lo) * px - (el.clientWidth - left) / 4)
    setView(v => ({ ...v, left: el.scrollLeft }))   // сразу, не дожидаясь события scroll
  }
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
      // в «Дне» — шаг час, иначе — целые дни
      const delta = scale === 'day' ? Math.round(dx / px * 24) / 24 : Math.round(dx / px)
      if (Math.abs(dx) <= 3) onOpen(ev.row, ids)
      else if (movable && delta) {
        const vals = { [config.start]: shiftDate(startF, ev.row[config.start], delta) }
        if (endF && ev.row[config.end] != null) vals[config.end] = shiftDate(endF, ev.row[config.end], delta)
        onMove(ev.row, vals)
      }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const { top: topTicks, bottom: units } = ticks(scale, d0, d1)
  const links = depLinks(layout.placed, byCol[config.deps] ? config.deps : null)
  const nowT = today + (now.getHours() * 60 + now.getMinutes()) / 1440
  const nowX = scale === 'day' ? nowT : today + 0.5   // в «Дне» — точное время, иначе — середина дня
  const totals = config.totals && units.map(u => events.reduce((n, e) => n + (e.t0 < u.b && e.t1 > u.a), 0))

  return (
    <section className="tl" aria-label="Таймлайн">
      <div className="tl-top">
        {left > 0 && <div className="tl-corner" style={{ width: left }}>{groupF && <>Сгруппировано по<br /><b>{groupF.title}</b></>}</div>}
        <div className="tl-scale">
          <div className="tl-months" style={{ transform: `translateX(${shift}px)` }}>
            {topTicks.filter(t => x(t.b) > view.left).map(t => (   // ушедшие за левый край — не показываем (иначе липнут к краю стопкой)
              <span key={t.a} style={{ left: Math.max(x(t.a), view.left) + 8 }}>{t.label}</span>
            ))}
          </div>
          <div className="tl-days" style={{ transform: `translateX(${shift}px)` }}>
            {units.map(u => (
              <div key={u.a} className={`tl-dayh${(scale === 'day' ? u.a <= nowT && nowT < u.b : u.a <= today && today < u.b) ? ' today' : ''}`}
                style={{ left: x(u.a), width: (u.b - u.a) * px }}>
                <span>{Array.isArray(u.label) ? <>{u.label[0]}<br />{u.label[1]}</> : u.label}</span>
              </div>))}
          </div>
        </div>
        <div className="tl-ctl">
          <button type="button" className="tool" onClick={() => goto(today)}>Сегодня</button>
          <select className="tool" aria-label="Масштаб" value={scale} onChange={e => setScale(e.target.value)}>
            {SCALES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <button type="button" className="tool" aria-label="Назад" onClick={() => body.current && (body.current.scrollLeft -= view.width * 0.8)}>‹</button>
          <button type="button" className="tool" aria-label="Вперёд" onClick={() => body.current && (body.current.scrollLeft += view.width * 0.8)}>›</button>
        </div>
      </div>
      <div className="tl-body" ref={body}>
        <div style={{ width: left + (hi - lo + 1) * px, height: Math.max(y, 1), position: 'relative' }}>
          {units.map(u => <div key={u.a} className="tl-gl" style={{ left: left + x(u.a), height: y }} />)}
          {nowX >= d0 && nowX <= d1 + 1 && <div className="tl-now" style={{ left: left + x(nowX), height: y }} />}
          {left > 0 && layout.lines.map((l, i) => (
            <div key={i} className={`tl-left ${l.kind}`} style={{ top: tops[i], left: view.left, width: left, height: l.kind === 'group' ? HEAD : ROW }}>
              {l.kind === 'group'
                ? <span className="pill" style={{ background: choiceColor(groupF.options?.choices?.find(c => c.name === l.value)?.color).bg, borderRadius: 999 }}>{l.value ?? 'Пусто'}</span>
                : <button type="button" className="tl-name" onClick={() => onOpen(l.ev.row, ids)}>{displayValue(byCol[primaryField], l.ev.row[primaryField])}</button>}
            </div>
          ))}
          {layout.lines.map((l, i) => l.kind === 'group' && <div key={'g' + i} className="tl-grouprow" style={{ top: tops[i], left, width: (hi - lo + 1) * px }} />)}
          {links.length > 0 && (
            <svg className="tl-deps" width={left + (hi - lo + 1) * px} height={Math.max(y, 1)} aria-hidden="true">
              <defs>{['ok', 'late'].map(k => <marker key={k} id={`tl-arr-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" className={`tl-dep ${k}`} /></marker>)}</defs>
              {links.map(({ from, to, late }) => {
                const ox = p => (drag?.ev === p.ev ? drag.dx : 0)
                const x1 = left + x(from.ev.t1) + ox(from), y1 = tops[from.line] + 17
                const x2 = left + x(to.ev.t0) + ox(to), y2 = tops[to.line] + 17
                const k = late ? 'late' : 'ok'
                return <path key={`${from.ev.row.id}-${to.ev.row.id}`} className={`tl-dep ${k}`} markerEnd={`url(#tl-arr-${k})`}
                  d={`M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2}`} />
              })}
            </svg>
          )}
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
              {units.map((u, i) => <div key={u.a} className="tl-tot" style={{ left: x(u.a), width: (u.b - u.a) * px, ...totalColor(config.totals.rules, totals[i]) }}>{totals[i]}</div>)}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
