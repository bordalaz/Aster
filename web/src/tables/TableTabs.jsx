import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/icons.jsx'

function plural(n) {
  const a = n % 10, b = n % 100
  return a === 1 && b !== 11 ? 'скрытая таблица' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'скрытые таблицы' : 'скрытых таблиц'
}

// Таблицы вкладками, как в Airtable: видимые — в строке, скрытые — в «N скрытых таблиц ▾».
// Открытая скрытая таблица видна вкладкой, пока открыта. onHide(id, hidden) — только у админов.
export default function TableTabs({ tables, activeId, onPick, onHide }) {
  const [menu, setMenu] = useState(null)   // 'hidden' | 'table'
  const active = useRef(null)
  const box = useRef(null)
  useEffect(() => { active.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [activeId])
  useEffect(() => {
    if (!menu) return
    const down = e => { if (box.current && !box.current.contains(e.target)) setMenu(null) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [menu])

  const hidden = tables.filter(t => t.hidden)
  const shown = tables.filter(t => !t.hidden || t.id === activeId)

  return (
    <div className="tabs" ref={box}>
      <div className="scroll" role="tablist" aria-label="Таблицы">
        {shown.map(t => t.id === activeId ? (
          <span key={t.id} className="tab-active" ref={active}>
            <button role="tab" className="tab" aria-selected="true" onClick={() => onPick(t.id)}>{t.title}</button>
            {onHide && <button className="tab-caret" aria-label={`Меню таблицы ${t.title}`} aria-expanded={menu === 'table'}
              onClick={() => setMenu(menu === 'table' ? null : 'table')}><Icon name="caretDown" size={12} /></button>}
          </span>
        ) : (
          <button key={t.id} role="tab" className="tab" aria-selected="false" onClick={() => onPick(t.id)}>{t.title}</button>
        ))}
      </div>
      {menu === 'table' && (
        <div className="pop menu" role="menu" style={{ left: (active.current?.getBoundingClientRect().left ?? 0), top: 88, position: 'fixed' }}>
          {(() => {
            const t = tables.find(x => x.id === activeId)
            return t && <button role="menuitem" onClick={() => { onHide(t.id, !t.hidden); setMenu(null) }}>
              <Icon name={t.hidden ? 'eye' : 'eyeSlash'} />{t.hidden ? 'Показать таблицу' : 'Скрыть таблицу'}
            </button>
          })()}
        </div>
      )}
      {hidden.length > 0 && (
        <div className="all" style={{ position: 'relative' }}>
          <button className="tool" aria-expanded={menu === 'hidden'} onClick={() => setMenu(menu === 'hidden' ? null : 'hidden')}>
            {hidden.length} {plural(hidden.length)} <Icon name="caretDown" size={12} />
          </button>
          {menu === 'hidden' && (
            <div className="pop menu" role="menu" style={{ right: 0, top: 30 }}>
              {hidden.map(t => (
                <div key={t.id} className="row" style={{ gap: 0 }}>
                  <button role="menuitem" style={{ flex: 1, fontWeight: t.id === activeId ? 500 : undefined }}
                    onClick={() => { onPick(t.id); setMenu(null) }}>
                    <Icon name="table" size={14} />{t.title}
                  </button>
                  {onHide && <button className="quiet" aria-label={`Показать ${t.title}`} title="Показать во вкладках"
                    onClick={() => onHide(t.id, false)}><Icon name="eye" size={14} /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
