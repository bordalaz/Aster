import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { displayValue, kindOf, NUMBER as NUM } from '../grid/cells.js'
import { rowColor } from '../grid/layout.js'
import { LIST_OPS, NO_VALUE, OPS } from '../grid/viewConfig.js'
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
  return data
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
  const tableIds = useMemo(() => (cfg ? [...new Set(walk(cfg.rows).map(e => e.table))].sort() : []), [cfg])
  const data = useTables(tableIds)
  if (!cfg) return <p style={{ padding: 16 }}>Загрузка…</p>
  const ready = tableIds.every(t => data[t])
  const rowsFor = el => {
    const t = data[el.table]
    return el.filter && conds[el.filter] ? applyConds(t.rows, t.fields, conds[el.filter]) : t.rows
  }
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

function Rows({ rows, data, rowsFor }) {
  return rows.map((r, i) => (
    <div key={i} className="dash-row">
      {r.map((col, j) => (
        <div key={j} className="dash-col" style={{ flex: col[0]?.w ?? 1 }}>
          {col.map((it, k) => (it.rows
            ? <Rows key={k} rows={it.rows} data={data} rowsFor={rowsFor} />
            : <Element key={k} el={it} fields={data[it.table].fields} rows={rowsFor(it)} />))}
        </div>
      ))}
    </div>
  ))
}

function Element({ el, fields, rows }) {
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
  const sorted = useMemo(() => {
    const out = [...rows]
    for (const s of [...el.sort].reverse()) {
      const f = fields[s.col]
      out.sort((a, b) => {
        const d = displayValue(f, a[s.col]).localeCompare(displayValue(f, b[s.col]), 'ru', { numeric: true })
        return s.desc ? -d : d
      })
    }
    return out
  }, [rows, el.sort, fields])
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
    const by = new Map()
    for (const r of rs) { const k = displayValue(f, r[g.col]); by.set(k, [...(by.get(k) ?? []), r]) }
    const keys = [...by.keys()].sort((a, b) => (a === '—') - (b === '—') || a.localeCompare(b, 'ru', { numeric: true }) * (g.desc ? -1 : 1))
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
