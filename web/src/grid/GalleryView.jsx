import { useMemo } from 'react'
import { CardValue, Carousel } from '../pages/Pages.jsx'
import { FieldButton } from '../card/ButtonField.jsx'
import { displayValue } from './cells.js'
import { orderRows } from './layout.js'
import { applyFilters, sortRows } from './viewConfig.js'

// Вид-галерея, как в Airtable: карточки — обложка (поле вложений, обрезка по рамке), заголовок
// (первичное поле), под ним видимые поля с подписями. Фильтр, сортировка, ручной порядок и поиск —
// из настроек вида; щелчок по карточке открывает запись.
export default function GalleryView({ fields, rows, primaryField, config, search = '', onOpen }) {
  const byCol = useMemo(() => Object.fromEntries(fields.map(f => [f.column_name, f])), [fields])
  const shown = (config.columns ?? fields.map(f => f.column_name))
    .filter(c => byCol[c] && c !== primaryField && c !== config.cover)
  const items = useMemo(() => {
    const rs = applyFilters(fields, rows, config.filters)
    const ordered = config.sort?.length ? sortRows(rs, byCol, config.sort) : orderRows(rs, config.rowOrder)
    const q = search.trim().toLowerCase()
    return q ? ordered.filter(r => [primaryField, ...shown].some(c => byCol[c] && displayValue(byCol[c], r[c]).toLowerCase().includes(q))) : ordered
  }, [fields, rows, byCol, config.filters, config.sort, config.rowOrder, search, primaryField, shown.join()])   // eslint-disable-line react-hooks/exhaustive-deps
  const title = r => (byCol[primaryField] ? displayValue(byCol[primaryField], r[primaryField]) : '') || `Запись №${r.id}`
  const open = r => onOpen(r, items.map(x => x.id))
  return (
    <section className="gl gv" aria-label="Галерея">
      {!items.length && <p className="dash-empty">Нет записей</p>}
      {items.map(r => (
        <article key={r.id} className="gl-card gv-card" onClick={() => open(r)}>
          <CardBody row={r} byCol={byCol} shown={shown} cover={config.cover} coverHeight={180} title={title(r)} onOpen={() => open(r)} />
        </article>
      ))}
    </section>
  )
}

// Тело карточки записи (галерея, канбан): обложка, заголовок-кнопка, поля с подписями.
export function CardBody({ row, byCol, shown, cover, coverHeight, title, onOpen }) {
  return (
    <>
      {cover && <Carousel files={row[cover]} height={coverHeight} dots />}
      <div className="gl-body">
        <button type="button" className="gl-name" onClick={e => { e.stopPropagation(); onOpen() }}>{title}</button>
        {shown.map(c => (
          <div key={c} className="gv-field">
            <small>{byCol[c].title}</small>
            <div className="gl-val">{byCol[c].kind === 'button' ? <FieldButton field={byCol[c]} row={row} /> : <CardValue field={byCol[c]} value={row[c]} />}</div>
          </div>
        ))}
      </div>
    </>
  )
}
