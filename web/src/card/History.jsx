import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { displayValue } from '../grid/cells.js'

const when = at => new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

// R11: история записи — кто, когда, поле, было → стало. Перечитывается при новой версии записи.
export default function History({ tableId, recordId, version, fields }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    let live = true
    api(`/api/tables/${tableId}/records/${recordId}/history`)
      .then(h => { if (live) setItems(h) })
      .catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [tableId, recordId, version])

  const show = (col, v) => {
    const f = fields.find(x => x.column_name === col)
    return f ? displayValue(f, v) : (v == null ? '—' : String(v))
  }

  return (
    <section aria-label="История изменений" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>История изменений</div>
      {items === null ? <div style={{ color: 'var(--muted)' }}>Загрузка…</div>
        : items.length === 0 ? <div style={{ color: 'var(--muted)' }}>Изменений не было</div>
        : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {items.map((e, i) => (
              <li key={i} style={{ fontSize: 12 }}>
                <div style={{ color: 'var(--muted)' }}><span className="num">{when(e.at)}</span> · {e.user}</div>
                <div><strong>{e.field}</strong>: {show(e.column_name, e.old)} → {show(e.column_name, e.new)}</div>
              </li>
            ))}
          </ul>}
    </section>
  )
}
