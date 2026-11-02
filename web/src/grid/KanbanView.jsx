import { useMemo, useState } from 'react'
import { displayValue } from './cells.js'
import { CardBody } from './GalleryView.jsx'
import { moveRows, orderRows } from './layout.js'
import { choiceColor } from './renderers.js'
import { applyFilters, sortRows } from './viewConfig.js'
import { Icon } from '../ui/icons.jsx'

// Канбан, как в Airtable: колонки — варианты поля выбора (config.stack) в их порядке, первой —
// «Без категории» (пусто); hideEmpty — пустые колонки скрыты. Карточки — как в галерее.
// Перетаскивание карточки в другую колонку меняет значение поля (onMove); внутри колонки — ручной
// порядок (только без сортировки, если вид можно менять). «+ Добавить запись» — в эту колонку.
export default function KanbanView({ fields, rows, primaryField, config, search = '', onOpen, canEdit, canReorder, onMove, onAdd }) {
  const byCol = useMemo(() => Object.fromEntries(fields.map(f => [f.column_name, f])), [fields])
  const stack = byCol[config.stack]
  const shown = (config.columns ?? fields.map(f => f.column_name))
    .filter(c => byCol[c] && c !== primaryField && c !== config.cover && c !== config.stack)
  const items = useMemo(() => {
    const rs = applyFilters(fields, rows, config.filters)
    const ordered = config.sort?.length ? sortRows(rs, byCol, config.sort) : orderRows(rs, config.rowOrder)
    const q = search.trim().toLowerCase()
    return q ? ordered.filter(r => [primaryField, ...shown].some(c => byCol[c] && displayValue(byCol[c], r[c]).toLowerCase().includes(q))) : ordered
  }, [fields, rows, byCol, config.filters, config.sort, config.rowOrder, search, primaryField, shown.join()])   // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState(null)   // {id, over: {col, before}}
  if (!stack) return <p className="dash-empty">Поле колонок канбана не найдено</p>

  const choices = stack.options?.choices ?? []
  const known = new Set(choices.map(c => c.name))
  const byStack = new Map([[null, []], ...choices.map(c => [c.name, []])])
  for (const r of items) {
    const v = r[config.stack] == null || r[config.stack] === '' ? null : r[config.stack]
    if (!byStack.has(v)) byStack.set(v, [])   // вариант удалён из поля — своя колонка в конце
    byStack.get(v).push(r)
  }
  const columns = [...byStack].filter(([, rs]) => !config.hideEmpty || rs.length)
  const title = r => (byCol[primaryField] ? displayValue(byCol[primaryField], r[primaryField]) : '') || `Запись №${r.id}`
  const draggable = canEdit && stack.editable
  const manual = canReorder && !config.sort?.length && !search

  function drop(value, before) {
    const row = items.find(r => r.id === drag?.id)
    setDrag(null)
    if (!row) return
    const from = row[config.stack] == null || row[config.stack] === '' ? null : row[config.stack]
    let order = null
    if (manual) {
      const all = orderRows(rows, config.rowOrder).map(r => r.id)
      const col = byStack.get(value) ?? []
      const target = before ?? col.filter(r => r.id !== row.id).at(-1)?.id
      if (target != null && target !== row.id) order = moveRows(all, [row.id], target, before == null)
    }
    if (from !== value || order) onMove(row, from !== value ? value : undefined, order)
  }

  return (
    <section className="kb" aria-label="Канбан">
      {columns.map(([value, rs]) => {
        const choice = choices.find(c => c.name === value)
        const c = choiceColor(choice?.color)
        const over = drag?.over?.col === value
        return (
          <div key={value ?? '∅'} className={`kb-col${over ? ' over' : ''}`} role="group" aria-label={value ?? 'Без категории'}
            onDragOver={draggable ? e => { e.preventDefault(); if (drag && !over) setDrag(d => ({ ...d, over: { col: value, before: null } })) } : undefined}
            onDrop={draggable ? e => { e.preventDefault(); drop(value, drag?.over?.col === value ? drag.over.before : null) } : undefined}>
            <div className="kb-head">
              {value == null
                ? <span className="pill kb-none">Без категории</span>
                : <span className="pill" style={{ background: known.has(value) ? c.bg : '#eee', color: c.fg, borderRadius: 999 }}>{value}</span>}
              <span className="kb-count">{rs.length}</span>
            </div>
            <div className="kb-cards">
              {!rs.length && <p className="kb-empty">Нет записей</p>}
              {rs.map(r => (
                <article key={r.id} data-id={r.id} className={`gl-card kb-card${drag?.id === r.id ? ' dragging' : ''}${over && drag.over.before === r.id ? ' drop-before' : ''}`}
                  draggable={draggable || undefined} onClick={() => onOpen(r, items.map(x => x.id))}
                  onDragStart={draggable ? e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(r.id)); setDrag({ id: r.id, over: null }) } : undefined}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={draggable ? e => { e.preventDefault(); e.stopPropagation(); if (drag && (drag.over?.col !== value || drag.over.before !== r.id)) setDrag(d => ({ ...d, over: { col: value, before: r.id } })) } : undefined}>
                  <CardBody row={r} byCol={byCol} shown={shown} cover={config.cover} coverHeight={140} title={title(r)}
                    onOpen={() => onOpen(r, items.map(x => x.id))} />
                </article>
              ))}
              {onAdd && stack.editable && (
                <button type="button" className="kb-add" onClick={() => onAdd(value)}><Icon name="plus" size={14} />Добавить запись</button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
