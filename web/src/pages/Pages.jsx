import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { displayValue, kindOf, NUMBER as NUM, sortKey } from '../grid/cells.js'
import { rowColor } from '../grid/layout.js'
import { choiceColor } from '../grid/renderers.js'
import { applyFilters, LIST_OPS, NO_VALUE, OPS, sortRows } from '../grid/viewConfig.js'
import FieldEditor from '../card/fields.jsx'
import Comments from '../card/Comments.jsx'
import { DownloadAll } from '../files/Files.jsx'
import { Icon } from '../ui/icons.jsx'
import { aggregate, applyConds, series } from './dash.js'
import { BarChart, PieChart, Tile, colorsFor, fmt } from './charts.jsx'

const UNIT = 48   // px на единицу высоты раскладки Airtable

// Интерфейсы, как в Airtable: страницы слева, справа выбранная.
export default function Pages() {
  const [pages, setPages] = useState(null)
  const [active, setActive] = useState(null)
  useEffect(() => {
    api('/api/pages').then(ps => { setPages(ps); setActive(a => a ?? ps[0]?.id ?? null) })
  }, [])
  if (!pages) return <p style={{ padding: 16 }}>Загрузка…</p>
  if (!pages.length) return <p style={{ padding: 16 }}>Интерфейсов нет.</p>
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <nav className="views-side" aria-label="Интерфейсы" style={{ width: 240 }}>
        {pages.map(p => (
          <button key={p.id} className="vs-item" style={{ paddingLeft: 10 }}
            aria-current={p.id === active ? 'true' : undefined} onClick={() => setActive(p.id)}><span>{p.title}</span></button>
        ))}
      </nav>
      {active && <Page key={active} id={active} />}
    </div>
  )
}

function useTables(ids) {
  const [data, setData] = useState({})
  const key = ids.join(',')
  useEffect(() => {
    let live = true
    Promise.all(ids.map(t => Promise.all([api(`/api/tables/${t}/fields`), api(`/api/tables/${t}/records`)])
      .then(([fs, rs]) => [t, { fields: Object.fromEntries(fs.map(f => [f.column_name, f])), rows: rs }])))
      .then(all => live && setData(Object.fromEntries(all)))
    return () => { live = false }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return [data, setData]
}

function walk(rows, out = []) {
  for (const r of rows) for (const col of r) for (const it of col) (it.rows ? walk(it.rows, out) : out.push(it))
  return out
}

function Page({ id }) {
  const [cfg, setCfg] = useState(null)
  const [conds, setConds] = useState({})   // id фильтра → условия, которые зритель поправил
  useEffect(() => {
    api(`/api/pages/${id}`).then(c => { setCfg(c); setConds(Object.fromEntries(c.filters.map(f => [f.id, f.conds]))) })
  }, [id])
  const tableIds = useMemo(() => (cfg ? [...new Set([...walk(cfg.rows).map(e => e.table), cfg.list?.table, cfg.gallery?.table].filter(Boolean))].sort() : []), [cfg])
  const [data, setData] = useTables(tableIds)
  if (!cfg) return <p style={{ padding: 16 }}>Загрузка…</p>
  const ready = tableIds.every(t => data[t])
  const rowsFor = el => {
    const t = data[el.table]
    return el.filter && conds[el.filter] ? applyConds(t.rows, t.fields, conds[el.filter]) : t.rows
  }
  if (cfg.gallery) return ready ? <Gallery cfg={cfg} data={data} /> : <p style={{ padding: 16 }}>Загрузка данных…</p>
  if (cfg.list) return ready ? <ListCard cfg={cfg} data={data} setData={setData} /> : <p style={{ padding: 16 }}>Загрузка данных…</p>
  return (
    <section className="dash" aria-label={cfg.title}>
      {/* как в Airtable: заголовка нет (страница выбрана слева), фильтры — панелями над элементами */}
      {cfg.filters.map(f => (
        <FilterBar key={f.id} filter={f} fields={data[f.table]?.fields ?? {}} conds={conds[f.id]}
          onChange={c => setConds(s => ({ ...s, [f.id]: c }))} onReset={() => setConds(s => ({ ...s, [f.id]: f.conds }))} />
      ))}
      {!ready ? <p>Загрузка данных…</p> : <Rows rows={cfg.rows} data={data} rowsFor={rowsFor} />}
    </section>
  )
}

// «Список + карточка», как в Airtable: слева записи (фильтр и сортировка страницы), справа выбранная —
// заголовок (первичное поле) и поля карточки в раскладке Airtable.
function ListCard({ cfg, data, setData }) {
  const { list } = cfg
  const t = data[list.table]
  const items = useMemo(() => sortRows(applyFilters(Object.values(t.fields), t.rows, list.filters), t.fields, list.sort),
    [t, list])
  const [sel, setSel] = useState(null)
  const record = items.find(r => r.id === sel) ?? items[0]
  const [first, ...rest] = list.columns.filter(c => t.fields[c])
  // правка поля из карточки: точечный PATCH со свежим updated_at, как в карточке записи
  const save = async (table, row, values) => {
    const res = await api(`/api/tables/${table}/records/${row.id}`, { method: 'PATCH', body: { updated_at: row.updated_at, values } })
    setData(d => ({ ...d, [table]: { ...d[table], rows: d[table].rows.map(r => (r.id === row.id ? { ...r, ...values, updated_at: res.updated_at } : r)) } }))
  }
  return (
    <section className="lc" aria-label={cfg.title}>
      <nav className="lc-list" aria-label="Записи">
        <div className="lc-count">{items.length} записей</div>
        {items.map(r => (
          <button key={r.id} type="button" className="lc-item" aria-current={r.id === record?.id ? 'true' : undefined}
            onClick={() => setSel(r.id)}>
            <span className="lc-title">{first ? displayValue(t.fields[first], r[first]) : `№${r.id}`}</span>
            {rest.map(c => <span key={c} className="lc-sub"><Value field={t.fields[c]} value={r[c]} /></span>)}
          </button>
        ))}
      </nav>
      <div className="lc-card">
        {!record ? <p className="dash-empty">Нет записей</p> : (
          <>
            {list.header.filter(c => t.fields[c]).map(c => <h2 key={c} className="lc-head">{displayValue(t.fields[c], record[c])}</h2>)}
            <Rows key={record.id} rows={cfg.rows} data={data} rowsFor={() => []} record={record} save={save} />
          </>
        )}
      </div>
    </section>
  )
}

// Галерея, как в Airtable: карточки (обложка-карусель, заголовок, поля), фильтр источника страницы.
// Щелчок по карточке — страница записи: «← Назад», заголовок, поля слева подписями (только чтение), справа комментарии.
function Gallery({ cfg, data }) {
  const g = cfg.gallery
  const t = data[g.table]
  const items = useMemo(() => applyFilters(Object.values(t.fields), t.rows, g.filters), [t, g])
  const [open, setOpen] = useState(null)
  const title = r => (t.fields[g.title] ? displayValue(t.fields[g.title], r[g.title]) : '') || `Запись №${r.id}`
  const record = items.find(r => r.id === open)
  if (record) {
    return (
      <section className="gl-page" aria-label={title(record)}>
        <div className="gl-main">
          <button type="button" className="gl-back" onClick={() => setOpen(null)}><Icon name="arrowLeft" size={14} />Назад к «{cfg.subtitle || cfg.title}»</button>
          <h1 className="gl-title">{title(record)}</h1>
          {cfg.rows.map(([[el]]) => {
            const f = t.fields[el.col]
            if (!f) return null
            return el.type === 'attachments'
              ? <div key={el.col} className="fld fld-inline"><span className="fld-label">{f.title}</span>
                  <div className="fld-value">
                    {(record[el.col] ?? []).length > 1 && <DownloadAll url={`/api/tables/${g.table}/records/${record.id}/attachments/${el.col}/zip`} n={record[el.col].length} />}
                    <Carousel files={record[el.col]} height={(el.h ?? 8) * UNIT} /></div></div>
              : <FieldEditor key={el.col} inline field={{ ...f, editable: false }} value={record[el.col]} onChange={() => {}} />
          })}
        </div>
        <Comments tableId={g.table} recordId={record.id} />
      </section>
    )
  }
  return (
    <section className="gl" aria-label={cfg.title}>
      {!items.length && <p className="dash-empty">Нет записей</p>}
      {items.map(r => (
        // вся карточка щёлкается, как в Airtable; с клавиатуры — заголовок-кнопка
        <article key={r.id} className="gl-card" onClick={() => setOpen(r.id)}>
          {g.cover && <Carousel files={r[g.cover]} height={147} dots />}
          <div className="gl-body">
            <button type="button" className="gl-name" onClick={e => { e.stopPropagation(); setOpen(r.id) }}>{title(r)}</button>
            {g.fields.filter(c => t.fields[c]).map(c => <div key={c} className="gl-val"><CardValue field={t.fields[c]} value={r[c]} /></div>)}
          </div>
        </article>
      ))}
    </section>
  )
}

// сразу сохраняются — как в Airtable; текст и числа — при уходе с поля или Enter (как в карточке записи)
const IMMEDIATE = new Set(['checkbox', 'singleSelect', 'multipleSelects', 'date', 'dateTime', 'duration'])

// Поле выбранной записи. Править можно, если в Airtable поле не «только чтение» и роль правит таблицу.
function PageField({ field, record, onSave }) {
  const [draft, setDraft] = useState(undefined)
  const [error, setError] = useState('')
  const col = field.column_name
  const commit = async v => {
    if (v === undefined || v === record[col]) { setDraft(undefined); return }
    setError('')
    try { await onSave({ [col]: v }) } catch { setError('Не удалось сохранить — значение не изменено') }
    setDraft(undefined)
  }
  return (
    <div className="lc-field" onBlur={() => !IMMEDIATE.has(field.kind) && commit(draft)}
      onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur() }}>
      <FieldEditor field={field} value={draft === undefined ? record[col] : draft}
        onChange={v => { setDraft(v); if (IMMEDIATE.has(field.kind)) commit(v) }} />
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  )
}

// Фото записи по одному, как карусель Airtable: вписаны в рамку, листаются стрелками.
export function Carousel({ files, height, dots = false }) {
  const imgs = (files ?? []).filter(f => /^image\//.test(f.mime ?? ''))
  const [i, setI] = useState(0)
  // на карточке галереи — пустая серая обложка, как в Airtable
  if (!imgs.length) return <div className="lc-carousel empty" style={{ height }}>{dots ? null : 'Нет фото'}</div>
  const f = imgs[Math.min(i, imgs.length - 1)]
  return (
    <div className="lc-carousel" style={{ height }}>
      <img src={`/api/attachments/${f.id}?inline=1`} alt={f.name} loading="lazy" />
      {imgs.length > 1 && <>
        <button type="button" className="lc-prev" aria-label="Предыдущее фото" onClick={e => { e.stopPropagation(); setI((i + imgs.length - 1) % imgs.length) }}>‹</button>
        <button type="button" className="lc-next" aria-label="Следующее фото" onClick={e => { e.stopPropagation(); setI((i + 1) % imgs.length) }}>›</button>
        {dots
          ? <span className="gl-dots" aria-label={`Фото ${(i % imgs.length) + 1} из ${imgs.length}`}>{imgs.slice(0, 5).map((_, k) => <i key={k} className={k === Math.min(i, 4) ? 'on' : undefined} />)}</span>
          : <span className="lc-pos">{(i % imgs.length) + 1} / {imgs.length}</span>}
      </>}
    </div>
  )
}

// Значение на карточке галереи, как в Airtable: пусто — серая черта, связи — плашки, галочка — ✓.
export function CardValue({ field, value }) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return <span className="gl-blank" aria-label={`${field.title}: пусто`} />
  if (field.kind === 'multipleRecordLinks') return [].concat(value).map(v => <span key={v.id ?? v} className="pill gl-link">{v.name ?? v}</span>)
  if (kindOf(field) === 'checkbox') return value ? <span className="link-card-check" aria-label="да">✓</span> : <span className="gl-blank" />
  if (field.kind === 'multipleAttachments') return <span>{value.length} файл.</span>
  return <span className="gl-text"><Value field={field} value={value} /></span>
}

// Значение в списке: у полей выбора — плашки цвета варианта, как в Airtable; остальное — текстом.
export function Value({ field, value }) {
  const choices = field.options?.choices ?? field.options?.result?.options?.choices
  if (!choices || value == null || value === '') return displayValue(field, value)
  const color = Object.fromEntries(choices.map(c => [c.name, c.color]))
  return [].concat(value).map(v => {
    const c = choiceColor(color[v])
    return <span key={v} className="pill" style={{ background: c.bg, color: c.fg, borderRadius: 999 }}>{v}</span>
  })
}

function Rows({ rows, data, rowsFor, record, save }) {
  return rows.map((r, i) => (
    <div key={i} className="dash-row">
      {r.map((col, j) => (
        // одна колонка в ряду — её ширина из 12 единиц Airtable; несколько — делят ряд пропорционально
        <div key={j} className="dash-col" style={{ flex: col[0]?.w ?? 1, maxWidth: r.length === 1 && col[0]?.w ? `${(col[0].w / 12) * 100}%` : undefined }}>
          {col.map((it, k) => (it.rows
            ? <Rows key={k} rows={it.rows} data={data} rowsFor={rowsFor} record={record} save={save} />
            : <Element key={k} el={it} fields={data[it.table].fields} rows={rowsFor(it)} record={record} save={save} />))}
        </div>
      ))}
    </div>
  ))
}

function Element({ el, fields, rows, record, save }) {
  if (el.type === 'field') {
    const f = fields[el.col]
    return f ? <PageField field={{ ...f, editable: f.editable && !el.readonly }} record={record}
      onSave={values => save(el.table, record, values)} /> : null
  }
  if (el.type === 'attachments') return <Carousel files={record?.[el.col]} height={(el.h ?? 6) * UNIT} />
  if (el.type === 'number') {
    return <Tile label={el.label} color={el.color} value={fmt(fields[el.col], aggregate(rows, fields[el.col], el.agg), el.agg)} />
  }
  if (el.type === 'grid') return <PageGrid el={el} fields={fields} rows={rows} />
  const s = series(rows, fields, el)
  const yField = fields[el.y.col]
  const show = v => fmt(yField, v, el.y.agg)
  const height = (el.h ?? 6) * UNIT - 60
  return (
    <figure className="dash-card">
      {el.title && <figcaption>{el.title}</figcaption>}
      <div className="dash-card-body">
        {!s.xs.length ? <p className="dash-empty">Нет данных</p>
          : el.kind === 'pie'
            ? <PieChart s={s} colorsOf={xs => colorsFor(xs, fields[el.x], el.colors)} show={show} height={height}
                legendTitle={fields[el.x]?.title} />
            : <BarChart s={s} colors={colorsFor(s.groups, fields[el.group], el.colors)} show={show} height={height}
                legendTitle={fields[el.group]?.title} />}
      </div>
    </figure>
  )
}

function PageGrid({ el, fields, rows }) {
  const cols = el.columns.filter(c => fields[c])
  const sorted = useMemo(() => sortRows(rows, fields, el.sort), [rows, el.sort, fields])
  const fs = Object.values(fields)
  const sum = (f, rs) => rs.reduce((a, r) => a + (typeof r[f.column_name] === 'number' ? r[f.column_name] : 0), 0)
  const sums = rs => cols.map(c => <td key={c} className="dash-sum">{NUM.has(kindOf(fields[c])) ? `Сумма ${fmt(fields[c], sum(fields[c], rs))}` : ''}</td>)
  const cell = (f, v) => (typeof v === 'number' ? fmt(f, v) : displayValue(f, v))
  const body = (rs, levels, depth = 0) => {
    const [g, ...rest] = levels
    if (!g) {
      return rs.map(r => {
        const bar = rowColor(el.color, fs, r)
        return <tr key={r.id}>{cols.map((c, i) => <td key={c} style={i === 0 && bar ? { boxShadow: `inset 4px 0 ${bar}` } : undefined}>{cell(fields[c], r[c])}</td>)}</tr>
      })
    }
    const f = fields[g.col]
    const by = new Map(), sk = new Map()
    for (const r of rs) { const k = displayValue(f, r[g.col]); by.set(k, [...(by.get(k) ?? []), r]); sk.has(k) || sk.set(k, sortKey(f, r[g.col])) }
    const keys = [...by.keys()].sort((a, b) => (a === '—') - (b === '—') || sk.get(a).localeCompare(sk.get(b), 'ru', { numeric: true }) * (g.desc ? -1 : 1))
    return keys.flatMap(k => [
      <tr key={`g${depth}:${k}`} className="dash-group">
        <th style={{ paddingLeft: 8 + depth * 16 }}><small>{f.title}</small>{k} <span>{by.get(k).length}</span></th>
        {sums(by.get(k)).slice(1)}
      </tr>,
      ...body(by.get(k), rest, depth + 1),
    ])
  }
  const colgroup = <colgroup>{cols.map(c => <col key={c} style={{ width: el.widths?.[c] }} />)}</colgroup>
  return (
    <div className="dash-card dash-grid">
      <div className="dash-grid-scroll">
        <table>
          {colgroup}
          <thead><tr>{cols.map(c => <th key={c}>{fields[c].title}</th>)}</tr></thead>
          <tbody>{body(sorted, (el.groups ?? []).filter(g => fields[g.col]))}</tbody>
        </table>
      </div>
      {/* итоги — отдельной таблицей под прокруткой, с теми же колонками */}
      <div className="dash-grid-foot">
        <table>{colgroup}<tbody><tr><td className="dash-count">{rows.length} записей</td>{sums(rows).slice(1)}</tr></tbody></table>
      </div>
    </div>
  )
}

// Фильтр страницы: условия из Airtable, значения правит зритель. Пустое значение — условие не действует.
// Панель фильтра, как в Airtable: подпись и «Сбросить» сверху, условия — «поле | оператор | значение».
function FilterBar({ filter, fields, conds, onChange, onReset }) {
  const set = (i, value) => onChange(conds.map((c, j) => (j === i ? { ...c, value } : c)))
  return (
    <div className="dash-filter" role="group" aria-label={filter.label ?? 'Фильтр'}>
      <div className="dash-filter-head">
        <span className="dash-filter-label">{filter.label}</span>
        <button type="button" className="dash-reset" onClick={onReset}>Сбросить</button>
      </div>
      <div className="dash-filter-conds">
      {conds.map((c, i) => {
        const f = fields[c.col]
        if (!f) return null
        const choices = (f.options?.choices ?? f.options?.result?.options?.choices ?? []).map(x => x.name)
        const list = LIST_OPS.has(c.op)
        const val = Array.isArray(c.value) ? c.value.join('; ') : c.value ?? ''
        return (
          <label key={i} className="dash-cond">
            <span className="dash-cond-field">{f.title}</span>
            <span className="dash-cond-op">{OPS[c.op]}</span>
            {!NO_VALUE.has(c.op) && (choices.length && !list
              ? <select value={val} onChange={e => set(i, e.target.value || null)}>
                  <option value="">любое</option>
                  {choices.map(x => <option key={x}>{x}</option>)}
                </select>
              : <input value={val} placeholder={list ? 'через ;' : 'любое'} list={choices.length ? `ch-${filter.id}-${i}` : undefined}
                  onChange={e => set(i, list ? e.target.value.split(';').map(x => x.trim()).filter(Boolean) : e.target.value || null)} />)}
            {choices.length > 0 && list && <datalist id={`ch-${filter.id}-${i}`}>{choices.map(x => <option key={x} value={x} />)}</datalist>}
          </label>
        )
      })}
      </div>
    </div>
  )
}
