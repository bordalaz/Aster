import { useState } from 'react'
import { dateParts, dayText, hasTime, parseDay, parseTime, partsToValue } from '../grid/cells.js'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const pad2 = x => String(x).padStart(2, '0')

// Выбор даты, как в Airtable: сверху поле даты (и времени) в формате поля, под ним календарь —
// месяц, стрелки, «Сегодня». Щелчок по дню: у даты — выбрать и закрыть, у даты со временем — выбрать день.
// onChange(value) — каждое изменение (null — очищено); onDone(value) — выбрать и закрыть.
export default function DatePicker({ field, value, onChange, onDone }) {
  const timed = hasTime(field)
  const cur = dateParts(field, value)
  const [dayStr, setDayStr] = useState(cur ? dayText(field, cur) : '')
  const [timeStr, setTimeStr] = useState(cur?.h != null ? `${pad2(cur.h)}:${pad2(cur.mi)}` : '')
  const now = new Date()
  const [view, setView] = useState({ y: cur?.y ?? now.getFullYear(), m: cur?.m ?? now.getMonth() + 1 })
  const [bad, setBad] = useState(false)

  // разобрать введённое → значение; undefined — ввод не разобрать
  function fromInputs(ds = dayStr, ts = timeStr) {
    if (!ds.trim()) return null
    const day = parseDay(field, ds)
    if (!day) return undefined
    if (!timed) return partsToValue(field, day)
    const t = ts.trim() ? parseTime(ts) : { h: 0, mi: 0 }
    return t ? partsToValue(field, { ...day, ...t }) : undefined
  }
  function typed(ds, ts) {
    setDayStr(ds); setTimeStr(ts)
    const v = fromInputs(ds, ts)
    setBad(v === undefined)
    if (v === undefined) return
    onChange(v)
    const p = v && parseDay(field, ds)
    if (p) setView({ y: p.y, m: p.m })
  }
  function pick(day) {
    const t = timed ? parseTime(timeStr) ?? { h: 0, mi: 0 } : {}
    const v = partsToValue(field, { ...day, ...t })
    setDayStr(dayText(field, day)); if (timed) setTimeStr(`${pad2(t.h)}:${pad2(t.mi)}`); setBad(false)
    if (timed) onChange(v); else onDone(v)
  }
  const step = k => setView(({ y, m }) => ({ y: y + Math.floor((m - 1 + k) / 12), m: ((m - 1 + k) % 12 + 12) % 12 + 1 }))
  const enter = e => {
    if (e.key !== 'Enter') return
    e.preventDefault(); e.stopPropagation()
    const v = fromInputs()
    if (v !== undefined) onDone(v)
  }

  // сетка месяца с понедельника
  const first = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7
  const days = new Date(view.y, view.m, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  const sel = parseDay(field, dayStr)
  const isToday = d => d === now.getDate() && view.m === now.getMonth() + 1 && view.y === now.getFullYear()

  return (
    <div className="dp" onKeyDown={enter}>
      <div className="dp-inputs">
        <input autoFocus aria-label="Дата" aria-invalid={bad || undefined} value={dayStr} placeholder="дд.мм.гггг"
          onChange={e => typed(e.target.value, timeStr)} />
        {timed && <input aria-label="Время" aria-invalid={bad || undefined} value={timeStr} placeholder="чч:мм" className="dp-time"
          onChange={e => typed(dayStr, e.target.value)} />}
      </div>
      <div className="dp-cal">
        <div className="dp-head">
          <strong aria-live="polite">{MONTHS[view.m - 1]} {view.y}</strong>
          <button type="button" className="link" onClick={() => pick({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })}>Сегодня</button>
        </div>
        <button type="button" className="dp-prev" aria-label="Предыдущий месяц" onClick={() => step(-1)}>‹</button>
        <button type="button" className="dp-next" aria-label="Следующий месяц" onClick={() => step(1)}>›</button>
        <table role="grid" aria-label={`${MONTHS[view.m - 1]} ${view.y}`}>
          <thead><tr>{WEEK.map(w => <th key={w} scope="col">{w}</th>)}</tr></thead>
          <tbody>{weeks.map((w, i) => (
            <tr key={i}>{w.map((d, j) => (
              <td key={j}>{d && (
                <button type="button" aria-label={`${d} ${MONTHS[view.m - 1]} ${view.y}`}
                  aria-pressed={sel?.d === d && sel.m === view.m && sel.y === view.y}
                  className={isToday(d) ? 'today' : undefined} onClick={() => pick({ y: view.y, m: view.m, d })}>{d}</button>
              )}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      </div>
      <button type="button" className="link dp-clear" onClick={() => onDone(null)}>Очистить</button>
    </div>
  )
}

// Редактор ячейки сетки (Glide): значение — в cell.data.value; Esc отменяет сам Glide.
export function GridDateEditor({ value: cell, onChange, onFinishedEditing }) {
  const set = v => ({ ...cell, data: { ...cell.data, value: v } })
  return <DatePicker field={cell.data.field} value={cell.data.value} onChange={v => onChange(set(v))} onDone={v => onFinishedEditing(set(v))} />
}
