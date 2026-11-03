import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { CardValue } from '../pages/Pages.jsx'
import { applyFilters } from './viewConfig.js'
import { Icon } from '../ui/icons.jsx'

// Вид «List» Airtable (levels): иерархия записей связанных таблиц сверху вниз — например,
// Заказчики → Работы → Рейсы. У каждого уровня свои колонки, ширины и фильтр; уровень ниже
// привязан к уровню выше полем-связью (link). Последний уровень — эта таблица.
// Записи верхних уровней грузятся с правами пользователя; щелчок открывает запись
// (своей таблицы — карточкой, чужой — переходом в её таблицу).

// Дети по родителю: {id родителя: [строки]} — по полю-связи уровня (запись с двумя родителями — под обоими).
export function childrenBy(rows, link) {
  const out = new Map()
  for (const r of rows) for (const p of [].concat(r[link] ?? [])) {
    const id = p?.id ?? p
    if (!out.has(id)) out.set(id, [])
    out.get(id).push(r)
  }
  return out
}

export default function ListView({ fields, rows, config, search = '', onOpen, onOpenLink }) {
  const levels = config.levels ?? []
  const [data, setData] = useState({})        // {table id: {fields, rows}} верхних уровней
  const [error, setError] = useState('')
  const [open, setOpen] = useState(new Set())  // раскрытые «уровень:id»
  useEffect(() => {
    let alive = true
    Promise.all(levels.slice(0, -1).map(l => Promise.all([api(`/api/tables/${l.table}/fields`), api(`/api/tables/${l.table}/records`)])
      .then(([fs, rs]) => [l.table, { fields: fs, rows: rs }])))
      .then(xs => alive && setData(Object.fromEntries(xs)), () => alive && setError('Нет доступа к таблице одного из уровней'))
    return () => { alive = false }
  }, [levels.map(l => l.table).join()])   // eslint-disable-line react-hooks/exhaustive-deps

  const lv = useMemo(() => levels.map((l, i) => {
    const d = i === levels.length - 1 ? { fields, rows } : data[l.table]
    if (!d) return null
    const byCol = Object.fromEntries(d.fields.map(f => [f.column_name, f]))
    const rs = applyFilters(d.fields, d.rows, l.filters)
    return { ...l, byCol, rows: rs, kids: i ? childrenBy(rs, l.link) : null, cols: l.columns.filter(c => byCol[c]) }
  }), [levels, data, fields, rows])

  if (!levels.length) return <p className="dash-empty">Уровни вида не настроены</p>
  if (error) return <p className="dash-empty">{error}</p>
  if (lv.some(x => !x)) return <p className="dash-empty">Загрузка…</p>

  const q = search.trim().toLowerCase()
  const text = (l, r) => l.cols.map(c => String(r[c]?.name ?? r[c] ?? '')).join(' ').toLowerCase()
  // поиск: запись показывается, если она или кто-то ниже неё подходит
  const hit = (k, r) => !q || text(lv[k], r).includes(q) || (k + 1 < lv.length && (lv[k + 1].kids.get(r.id) ?? []).some(c => hit(k + 1, c)))
  const toggle = key => setOpen(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const width = (l, c) => l.widths?.[c] ?? 160
  const head = (k, depth) => (
    <div className="ls-row ls-head" style={{ paddingLeft: 8 + depth * 24 }}>
      <span className="ls-caret" />
      {lv[k].cols.map(c => <span key={c} className="ls-cell" style={{ width: width(lv[k], c) }}>{lv[k].byCol[c].title}</span>)}
    </div>
  )
  const branch = (k, list, depth) => list.filter(r => hit(k, r)).map(r => {
    const l = lv[k], key = `${k}:${r.id}`, kids = k + 1 < lv.length ? (lv[k + 1].kids.get(r.id) ?? []).filter(c => hit(k + 1, c)) : null
    if (kids && !kids.length && config.hideEmpty) return null
    const isOpen = open.has(key) || (q && kids?.length)
    const leaf = k === lv.length - 1
    return (
      <Fragment key={key}>
        <div className={`ls-row ls-l${k}`} style={{ paddingLeft: 8 + depth * 24 }}>
          {kids?.length ? (
            <button type="button" className="ls-caret" aria-expanded={!!isOpen} aria-label={isOpen ? 'Свернуть' : 'Развернуть'} onClick={() => toggle(key)}>
              <Icon name="caretDown" size={12} style={isOpen ? undefined : { transform: 'rotate(-90deg)' }} />
            </button>
          ) : <span className="ls-caret" />}
          {l.cols.map((c, i) => (
            <span key={c} className="ls-cell" style={{ width: width(l, c) }}>
              {i === 0
                ? <button type="button" className="ls-name" onClick={() => (leaf ? onOpen(r, l.rows.map(x => x.id)) : onOpenLink?.(l.table, r.id))}>
                    <CardValue field={l.byCol[c]} value={r[c]} />
                  </button>
                : <CardValue field={l.byCol[c]} value={r[c]} />}
            </span>
          ))}
          {kids?.length > 0 && <span className="ls-count">{kids.length}</span>}
        </div>
        {isOpen && kids?.length > 0 && <>{head(k + 1, depth + 1)}{branch(k + 1, kids, depth + 1)}</>}
      </Fragment>
    )
  })

  return (
    <section className="ls" aria-label="Список">
      <div className="ls-bar">
        <button type="button" className="tool" onClick={() => setOpen(new Set(lv.slice(0, -1).flatMap((l, k) => l.rows.map(r => `${k}:${r.id}`))))}>Развернуть всё</button>
        <button type="button" className="tool" onClick={() => setOpen(new Set())}>Свернуть всё</button>
      </div>
      <div className="ls-body">
        {head(0, 0)}
        {branch(0, lv[0].rows, 0)}
      </div>
    </section>
  )
}
