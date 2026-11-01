import { useEffect, useState } from 'react'
import { api } from '../api.js'

const cache = new Map()   // таблица → названия записей (на сессию; новые записи увидит перезагрузка)
const load = id => {
  if (!cache.has(id)) cache.set(id, api(`/api/tables/${id}/names`).catch(e => { cache.delete(id); throw e }))
  return cache.get(id)
}

// Выбор связанных записей: поиск по названию, выбранные — плашками с «×» (R12).
export default function LinkPicker({ field, title, value, onChange }) {
  const [names, setNames] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { if (field.link_table) load(field.link_table).then(setNames, () => setNames([])) }, [field.link_table])

  const chosen = value ?? []
  const byId = new Map((names ?? []).map(n => [n.id, n.name]))
  const s = q.trim().toLowerCase()
  const found = s ? (names ?? []).filter(n => !chosen.includes(n.id) && n.name.toLowerCase().includes(s)).slice(0, 20) : []

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{title}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {chosen.map(id => (
          <span key={id} className="btn" style={{ cursor: 'default' }}>
            {byId.get(id) ?? `№${id}`}{' '}
            <button type="button" aria-label={`Убрать ${byId.get(id) ?? id}`} style={{ border: 0, background: 'none', cursor: 'pointer' }}
              onClick={() => onChange(chosen.filter(x => x !== id))}>×</button>
          </span>
        ))}
      </div>
      <input aria-label={`Поиск: ${title}`} placeholder={names ? 'Начните вводить название' : 'Загрузка…'} value={q}
        disabled={!field.link_table || !names} onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
      {found.length > 0 && (
        <div style={{ display: 'grid', gap: 2, marginTop: 4, maxHeight: 220, overflowY: 'auto' }}>
          {found.map(n => (
            <button key={n.id} type="button" className="btn" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={n.name} onClick={() => { onChange([...chosen, n.id]); setQ('') }}>{n.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
