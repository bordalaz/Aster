import { useMemo, useState } from 'react'
import './PersonnelDashboard.css'

const nfmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const statuses = ['В штате', 'Уволился', 'Офис', 'Цех']
const col = (fields, title) => Object.entries(fields || {}).find(([, f]) => f.title === title)?.[0]
const val = (row, key) => key ? row?.[key] : null
const scalar = value => value && typeof value === 'object' ? value.name ?? value.title ?? value.id ?? '' : value
const text = value => value == null || value === '' ? '—' : String(scalar(value))
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const list = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(scalar).filter(x => x != null && x !== '').map(String)
const countFor = (row, key) => Array.isArray(val(row, key)) ? val(row, key).length : list(val(row, key)).length
const participationCount = (row, numericKey, linkKey) => numeric(val(row, numericKey)) ?? countFor(row, linkKey)

export default function PersonnelDashboard({ fields, rows = [], onOpen }) {
  const name = col(fields, 'Фамилия Имя Отчество') || col(fields, 'ФИО')
  const surname = col(fields, 'Фамилия'), first = col(fields, 'Имя'), patronymic = col(fields, 'Отчество')
  const status = col(fields, 'Статус'), rating = col(fields, 'Рейтинг APS')
  const trips = col(fields, 'Всего рейсов с APS') || col(fields, 'ID_Рейсы APS')
  const works = col(fields, 'Всего работ с APS')
  const incidents = col(fields, 'Всего отказов')
  const tripLinks = col(fields, 'ID_Рейсы APS'), npvLinks = col(fields, 'ID_НПВ')
  const phone = col(fields, 'Телефон'), email = col(fields, 'Email'), number = col(fields, '№')
  const [query, setQuery] = useState(''), [minRating, setMinRating] = useState(''), [statusFilter, setStatusFilter] = useState('В штате')
  const [metric, setMetric] = useState('trips'), [showAll, setShowAll] = useState(false)
  const getName = row => text(val(row, name) ?? [surname, first, patronymic].map(k => val(row, k)).filter(Boolean).join(' '))
  const filtered = useMemo(() => rows.filter(row => {
    const r = numeric(val(row, rating)), min = numeric(minRating)
    return (!query || getName(row).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))) &&
      (min === null || (r !== null && r >= min)) && (!statusFilter || text(val(row, status)) === statusFilter)
  }), [rows, query, minRating, statusFilter, name, surname, first, patronymic, rating, status])
  const staff = filtered.length
  const tripCount = filtered.reduce((sum, row) => sum + participationCount(row, col(fields, 'Всего рейсов с APS'), tripLinks), 0)
  const ratings = filtered.map(row => numeric(val(row, rating))).filter(v => v !== null)
  const avg = ratings.length ? nfmt.format(ratings.reduce((a, b) => a + b, 0) / ratings.length) : '—'
  const incidentPeople = filtered.filter(row => (numeric(val(row, incidents)) ?? 0) > 0).length
  const statusCounts = statuses.map(s => filtered.filter(row => text(val(row, status)) === s).length)
  const maxStatus = Math.max(1, ...statusCounts)
  const metricKey = metric === 'trips' ? trips : works
  const top = [...filtered].sort((a, b) => (numeric(val(b, metricKey)) ?? 0) - (numeric(val(a, metricKey)) ?? 0)).slice(0, 8)
  const maxTop = Math.max(1, ...top.map(row => numeric(val(row, metricKey)) ?? 0))
  const attention = [...filtered].filter(row => (numeric(val(row, incidents)) ?? 0) > 0).sort((a, b) => (numeric(val(b, incidents)) ?? 0) - (numeric(val(a, incidents)) ?? 0)).slice(0, 5)
  const reset = () => { setQuery(''); setMinRating(''); setStatusFilter('В штате') }
  const open = row => onOpen?.(row.id)
  const linkCount = (row, key) => countFor(row, key)
  return <section className="personnel-dashboard" aria-label="Персонал APS">
    <header className="personnel-head"><div><h1>Персонал APS</h1><p>Показатели команды за всё время</p></div><div className="personnel-actions"><span className="personnel-total">{nfmt.format(filtered.length)} сотрудников</span><button type="button" onClick={() => window.print()}>Печать / PDF</button></div></header>
    <section className="personnel-print-summary"><strong>Параметры отчёта</strong><span>Период: За всё время</span><span>Сотрудник: {query || 'все'}</span><span>Статус: {statusFilter || 'все'}</span><span>Рейтинг APS от: {minRating || 'любой'}</span></section>
    <section className="personnel-filters" aria-label="Фильтры"><label>Поиск по ФИО<input aria-label="Поиск по ФИО" value={query} onChange={e => setQuery(e.target.value)} placeholder="Фамилия или имя" /></label><label>Рейтинг APS от<input aria-label="Рейтинг APS от" type="number" min="0" max="10" step="0.1" value={minRating} onChange={e => setMinRating(e.target.value)} placeholder="0–10" /></label><label>Статус<select aria-label="Статус" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Все статусы</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></label><button type="button" onClick={reset}>Сбросить</button></section>
    <div className="personnel-metrics"><article><span>Сотрудники в выборке</span><strong>{nfmt.format(staff)}</strong></article><article><span>Участия в рейсах</span><strong>{nfmt.format(tripCount)}</strong><small>Сумма участий сотрудников, не уникальные рейсы</small></article><article><span>Средний рейтинг APS</span><strong>{avg}</strong><small>Без сотрудников с незаполненным рейтингом</small></article><article><span>Сотрудники с зарегистрированными отказами</span><strong>{nfmt.format(incidentPeople)}</strong></article></div>
    <div className="personnel-visuals"><article className="personnel-card"><h2>Распределение по статусу</h2><p>Количество сотрудников</p>{statuses.map((s, i) => <button className="personnel-status-row" key={s} aria-pressed={statusFilter === s} onClick={() => setStatusFilter(cur => cur === s ? '' : s)}><span>{s}</span><i><b style={{ width: `${statusCounts[i] / maxStatus * 100}%` }} /></i><strong>{statusCounts[i]}</strong></button>)}</article><article className="personnel-card"><div className="personnel-card-title"><div><h2>Опыт в APS</h2><p>Сотрудники с наибольшим числом участий</p></div><label>Метрика<select aria-label="Метрика графика" value={metric} onChange={e => setMetric(e.target.value)}><option value="trips">Рейсы</option><option value="works">Работы</option></select></label></div>{top.length ? <div className="personnel-rank">{top.map((row, i) => <button key={row.id ?? i} onClick={() => open(row)}><span>{getName(row)}</span><i><b style={{ width: `${(numeric(val(row, metricKey)) ?? 0) / maxTop * 100}%` }} /></i><strong>{numeric(val(row, metricKey)) === null ? '—' : nfmt.format(numeric(val(row, metricKey)))}</strong></button>)}</div> : <p className="personnel-empty">Нет данных для графика.</p>}</article></div>
    <article className="personnel-card personnel-attention"><h2>Сотрудники с зарегистрированными отказами</h2><p>Наличие связи в данных не устанавливает вину сотрудника.</p>{attention.length ? attention.map((row, i) => <button key={row.id ?? i} onClick={() => open(row)}><strong>{getName(row)}</strong><span>{nfmt.format(numeric(val(row, incidents)))}</span><small>Открыть карточку</small></button>) : <p className="personnel-empty">Зарегистрированных связей нет.</p>}</article>
    <div className="personnel-directory-head"><h2>Справочник сотрудников <span>({filtered.length})</span></h2><button type="button" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? 'Скрыть справочник' : 'Показать сотрудников'}</button></div>
    {showAll && <article className="personnel-card personnel-directory">{filtered.length ? <table><thead><tr><th>№</th><th>ФИО</th><th>Статус</th><th>Рейтинг APS</th><th>Всего рейсов с APS</th><th>Всего работ с APS</th><th>Всего отказов</th><th>ID_Рейсы APS</th><th>ID_НПВ</th><th>Телефон</th><th>Email</th><th></th></tr></thead><tbody>{filtered.map((row, i) => <tr key={row.id ?? i} onClick={() => open(row)}><td>{text(val(row, number))}</td><td>{getName(row)}</td><td>{text(val(row, status))}</td><td>{numeric(val(row, rating)) === null ? '—' : nfmt.format(numeric(val(row, rating)))}</td><td>{numeric(val(row, trips)) === null ? '—' : nfmt.format(numeric(val(row, trips)))}</td><td>{numeric(val(row, works)) === null ? '—' : nfmt.format(numeric(val(row, works)))}</td><td>{numeric(val(row, incidents)) === null ? '—' : nfmt.format(numeric(val(row, incidents)))}</td><td>{linkCount(row, tripLinks) || '—'}</td><td>{linkCount(row, npvLinks) || '—'}</td><td>{text(val(row, phone))}</td><td>{text(val(row, email))}</td><td><button type="button" onClick={e => { e.stopPropagation(); open(row) }}>Открыть</button></td></tr>)}</tbody></table> : <p className="personnel-empty">Сотрудников нет.</p>}</article>}
  </section>
}
