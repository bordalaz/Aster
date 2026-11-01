import { useState } from 'react'
import { choiceColor } from './renderers.js'
import { Icon } from '../ui/icons.jsx'

// Список вариантов прямо в ячейке, как в Airtable: поиск, плашки цвета варианта.
// Один вариант — щелчок выбирает и закрывает; несколько — щелчок переключает.
export default function SelectEditor({ value: cell, onChange, onFinishedEditing }) {
  const [q, setQ] = useState('')
  const { choices, multi, value } = cell.data
  const chosen = new Set(multi ? value ?? [] : value ? [value] : [])
  const shown = choices.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase()))
  const withValue = v => ({ ...cell, data: { ...cell.data, value: v } })

  function pick(name) {
    if (!multi) { onFinishedEditing(withValue(name)); return }
    const next = chosen.has(name) ? [...chosen].filter(x => x !== name) : [...chosen, name]
    onChange(withValue(next))
  }

  return (
    <div className="sel-editor">
      <input autoFocus placeholder="Найти вариант" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && shown.length === 1) { e.preventDefault(); pick(shown[0].name) } }} />
      <ul role="listbox" aria-multiselectable={multi || undefined}>
        {shown.map(c => {
          const col = choiceColor(c.color)
          return (
            <li key={c.name} role="option" aria-selected={chosen.has(c.name)} aria-label={c.name} onClick={() => pick(c.name)}>
              <span className="pill" style={{ background: col.bg, color: col.fg, borderRadius: 999 }}>{c.name}</span>
              {chosen.has(c.name) && <Icon name="check" size={14} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
            </li>
          )
        })}
        {shown.length === 0 && <li className="empty">Нет таких вариантов</li>}
      </ul>
      <button type="button" className="link" onClick={() => onFinishedEditing(withValue(multi ? [] : null))}>Очистить</button>
    </div>
  )
}
