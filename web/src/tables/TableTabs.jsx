import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/icons.jsx'

// Таблицы вкладками в строку, как в Airtable; все таблицы — ещё и списком в «Все таблицы».
export default function TableTabs({ tables, activeId, onPick }) {
  const [open, setOpen] = useState(false)
  const active = useRef(null)
  useEffect(() => { active.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [activeId])

  return (
    <div className="tabs">
      <div className="scroll" role="tablist" aria-label="Таблицы">
        {tables.map(t => (
          <button key={t.id} role="tab" className="tab" aria-selected={t.id === activeId}
            ref={t.id === activeId ? active : undefined} onClick={() => onPick(t.id)}>{t.title}</button>
        ))}
      </div>
      <div className="all" style={{ position: 'relative' }}>
        <button className="tool" aria-expanded={open} onClick={() => setOpen(!open)}>
          Все таблицы <Icon name="caretDown" size={12} />
        </button>
        {open && (
          <div className="pop menu" style={{ right: 0, top: 30 }} role="menu" onMouseLeave={() => setOpen(false)}>
            {tables.map(t => (
              <button key={t.id} role="menuitem" onClick={() => { onPick(t.id); setOpen(false) }}
                style={t.id === activeId ? { fontWeight: 500 } : undefined}>
                <Icon name="table" size={14} />{t.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
