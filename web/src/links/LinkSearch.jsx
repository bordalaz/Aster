import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { linkNames, tableMeta } from './data.js'
import MiniFields from './MiniFields.jsx'
import { Icon } from '../ui/icons.jsx'

const LIMIT = 50
const rowCache = new Map()   // таблица → {id: строка} — поля мини-карточек уже показанных записей

// Выбор связанной записи, как в Airtable: поиск сверху, ниже мини-карточки (название и первые поля).
// ↑↓ — по списку, Enter — выбрать (поиск очищается — можно искать следующую), Esc — закрыть. exclude — уже выбранные (их в списке нет).
// onCreate(текст поиска) — «+» и «Создать запись», как «Create a new item» в Airtable.
export default function LinkSearch({ field, exclude = [], initial = '', onPick, onClose, onCreate }) {
  const [names, setNames] = useState(null)
  const [q, setQ] = useState(initial)
  const [at, setAt] = useState(0)
  const [cols, setCols] = useState([])
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await onCreate(q) } catch (e) { setError(e.status === 403 ? 'Нет прав добавлять записи в эту таблицу' : 'Не удалось создать запись'); setBusy(false) }
  }
  useEffect(() => { linkNames(field.link_table).then(setNames, () => setNames([])) }, [field.link_table])
  useEffect(() => { tableMeta(field.link_table).then(setCols, () => {}) }, [field.link_table])

  const found = useMemo(() => {
    const s = q.trim().toLowerCase(), ex = new Set(exclude)
    return (names ?? []).filter(n => !ex.has(n.id) && (!s || n.name.toLowerCase().includes(s))).slice(0, LIMIT)
  }, [names, q, exclude])
  useEffect(() => setAt(0), [q])

  // поля мини-карточек — догружаем только тех, кого ещё не видели; пауза склеивает набор букв
  if (!rowCache.has(field.link_table)) rowCache.set(field.link_table, {})
  const cache = rowCache.get(field.link_table)
  const missing = found.filter(n => !(n.id in cache)).map(n => n.id).join(',')
  useEffect(() => {
    if (!missing || !cols.length) return
    let live = true
    const t = setTimeout(() => api(`/api/tables/${field.link_table}/records?ids=${missing}`).then(rows => {
      for (const id of missing.split(',')) cache[id] = null
      for (const r of rows) cache[r.id] = r
      if (live) setTick(x => x + 1)
    }).catch(() => {}), 250)
    return () => { live = false; clearTimeout(t) }
  }, [field.link_table, missing, cols.length])   // eslint-disable-line react-hooks/exhaustive-deps

  const keyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(i + 1, found.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (found[at]) { onPick(found[at]); setQ('') } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }
  return (
    <div className="link-search" onKeyDown={keyDown}>
      <div className="link-search-head">
        <input autoFocus aria-label={`Поиск: ${field.title}`} placeholder="Поиск" value={q} onChange={e => setQ(e.target.value)} />
        {onCreate && <button type="button" className="link-editor-add" aria-label="Новая запись" title="Новая запись" disabled={busy}
          onMouseDown={e => e.preventDefault()} onClick={create}><Icon name="plus" size={12} /></button>}
      </div>
      <ul role="listbox" aria-label={field.title}>
        {found.map((n, i) => (
          <li key={n.id} role="option" aria-selected={i === at} aria-label={n.name} onMouseEnter={() => setAt(i)}
            onMouseDown={e => e.preventDefault()} onClick={() => { onPick(n); setQ('') }}>
            <span className="link-card-name">{n.name || `№${n.id}`}</span>
            <MiniFields cols={cols} row={cache[n.id]} />
          </li>
        ))}
        {names === null && <li className="empty">Загрузка…</li>}
        {names !== null && !found.length && !onCreate && <li className="empty">Нет таких записей</li>}
      </ul>
      {onCreate && names !== null && (q.trim() || !found.length) && (
        <button type="button" className="link-create" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={create}>
          {q.trim() ? `Создать запись «${q.trim()}»` : 'Создать запись'}
        </button>
      )}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  )
}
