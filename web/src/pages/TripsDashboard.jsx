import { useMemo, useState } from 'react'
import './TripsDashboard.css'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const statuses = ['В работе', 'Планируется', 'Закончен']
const field = (fields, title) => Object.entries(fields || {}).find(([, item]) => item.title === title)?.[0]
const raw = (row, column) => column ? row?.[column] : null
const scalar = item => item && typeof item === 'object' ? item.name ?? item.title ?? item.id ?? '' : item
const display = item => item === null || item === undefined || item === '' ? '—' : String(scalar(item))
const dateValue = value => { if (!value) return ''; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10) }
const list = value => (Array.isArray(value) ? value : value ? [value] : []).map(scalar).filter(x => x !== '').map(String)
const uniqueOptions = (rows, column) => [...new Set(rows.flatMap(row => list(raw(row, column))))].sort((a, b) => a.localeCompare(b, 'ru'))
const numeric = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)

function Metric({ label, value, unit = '', onClick }) {
  return <button type="button" className="ops-metric" aria-label={label} onClick={onClick}><span>{label}</span><strong>{value}{unit && value !== '—' ? ` ${unit}` : ''}</strong><small>Подробности</small></button>
}

export default function TripsDashboard({ fields, rows = [], onOpen }) {
  const col = title => field(fields, title)
  const started = col('Начало'), trip = col('ID_Рейса_APS'), status = col('Статус')
  const hours = col('Циркуляция, час'), npv = col('Время НПВ'), failure = col('Отказ ТС')
  const customer = col('Заказчик') || col('ID_Заказчик'), engineer = col('ID_Инженеры')
  const year = new Date().getFullYear()
  const [from, setFrom] = useState(`${year}-01-01`), [to, setTo] = useState(`${year}-12-31`)
  const [statusFilter, setStatusFilter] = useState(''), [customerFilter, setCustomerFilter] = useState(''), [engineerFilter, setEngineerFilter] = useState(''), [monthFilter, setMonthFilter] = useState('')
  const [showAll, setShowAll] = useState(false), [detail, setDetail] = useState('')
  const filtered = useMemo(() => rows.filter(row => {
    const date = dateValue(raw(row, started))
    return (!from || (date && date >= from)) && (!to || (date && date <= to)) && (!statusFilter || display(raw(row, status)) === statusFilter) && (!customerFilter || list(raw(row, customer)).includes(customerFilter)) && (!engineerFilter || list(raw(row, engineer)).includes(engineerFilter)) && (!monthFilter || date.slice(0, 7) === monthFilter)
  }), [rows, started, from, to, statusFilter, customerFilter, engineerFilter, monthFilter, status, customer, engineer])
  const counts = statuses.map(label => filtered.filter(row => display(raw(row, status)) === label).length)
  const totalStatus = counts.reduce((a, b) => a + b, 0)
  const shares = counts.map(n => totalStatus ? n / totalStatus * 100 : 0)
  const donutStyle = { background: totalStatus ? `conic-gradient(#3158b7 0 ${shares[0]}%, #e5a63b ${shares[0]}% ${shares[0] + shares[1]}%, #3c9a68 ${shares[0] + shares[1]}% 100%)` : '#e8ebf1' }
  const monthly = useMemo(() => {
    const map = new Map()
    rows.filter(row => { const d = dateValue(raw(row, started)); return (!from || (d && d >= from)) && (!to || (d && d <= to)) && (!statusFilter || display(raw(row, status)) === statusFilter) && (!customerFilter || list(raw(row, customer)).includes(customerFilter)) && (!engineerFilter || list(raw(row, engineer)).includes(engineerFilter)) }).forEach(row => { const m = dateValue(raw(row, started)).slice(0, 7); if (m) map.set(m, (map.get(m) || 0) + 1) })
    return [...map].sort(([a], [b]) => a.localeCompare(b))
  }, [rows, started, from, to, statusFilter, customerFilter, engineerFilter, status, customer, engineer])
  const maxMonth = Math.max(1, ...monthly.map(([, n]) => n))
  const npvValues = filtered.map(row => numeric(raw(row, npv))).filter(v => v !== null)
  const npvTotal = npvValues.length ? number.format(npvValues.reduce((a, b) => a + b, 0)) : '—'
  const hourValues = filtered.map(row => numeric(raw(row, hours))).filter(v => v !== null)
  const hoursTotal = hourValues.length ? number.format(hourValues.reduce((a, b) => a + b, 0)) : '—'
  const failures = filtered.filter(row => raw(row, failure) === true || (raw(row, failure) && raw(row, failure) !== 'false')).length
  const byNpv = (a, b) => (numeric(raw(b, npv)) ?? -Infinity) - (numeric(raw(a, npv)) ?? -Infinity)
  const attention = [...filtered].filter(row => raw(row, failure) === true || (numeric(raw(row, npv)) ?? 0) > 0).sort((a, b) => byNpv(a, b) || String(raw(a, trip) ?? '').localeCompare(String(raw(b, trip) ?? ''), 'ru', { numeric: true })).slice(0, 5)
  const reset = () => { setFrom(`${year}-01-01`); setTo(`${year}-12-31`); setStatusFilter(''); setCustomerFilter(''); setEngineerFilter(''); setMonthFilter('') }
  const openDetail = key => setDetail(current => current === key ? '' : key)
  const openTrip = row => onOpen?.(row.id)
  const tripLabel = row => display(raw(row, trip))
  const npvLabel = row => numeric(raw(row, npv)) === null ? '—' : `${number.format(numeric(raw(row, npv)))} ч`
  const statusClass = value => value === statuses[0] ? 'active' : value === statuses[1] ? 'planned' : 'done'
  const printGeneratedAt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
  return <section className="ops-dashboard" aria-label="Аналитика рейсов APS">
    <header className="ops-head"><div><h1>Рейсы APS</h1><p>Состояние рейсов, НПВ и циркуляция за выбранный период</p></div><div className="ops-head-actions"><span className="ops-total">{number.format(filtered.length)} записей</span><button type="button" className="ops-print" onClick={() => window.print()}>Печать / PDF</button></div></header>
    <section className="ops-print-summary" aria-label="Параметры отчёта"><strong>Параметры отчёта</strong><span>Период: {from || 'без начала'} — {to || 'без окончания'}</span><span>Статус: {statusFilter || 'все'}</span><span>Заказчик: {customerFilter || 'все'}</span><span>Инженер: {engineerFilter || 'все'}</span><span>Месяц: {monthFilter || 'все'}</span><time>Сформировано: {printGeneratedAt}</time></section>
    <section className="ops-filters" aria-label="Фильтры"><label>С даты<input aria-label="С даты" type="date" value={from} onChange={e => { setFrom(e.target.value); setMonthFilter('') }} /></label><label>По дату<input aria-label="По дату" type="date" value={to} onChange={e => { setTo(e.target.value); setMonthFilter('') }} /></label><label>Статус<select aria-label="Статус" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Все статусы</option>{statuses.map(x => <option key={x}>{x}</option>)}</select></label><label>Заказчик<select aria-label="Заказчик" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}><option value="">Все заказчики</option>{uniqueOptions(rows, customer).map(x => <option key={x}>{x}</option>)}</select></label><label>Инженер<select aria-label="Инженер" value={engineerFilter} onChange={e => setEngineerFilter(e.target.value)}><option value="">Все инженеры</option>{uniqueOptions(rows, engineer).map(x => <option key={x}>{x}</option>)}</select></label><button type="button" className="ops-reset" onClick={reset}>Сбросить</button></section>
    <div className="ops-metrics"><Metric label="Всего рейсов" value={number.format(filtered.length)} onClick={() => openDetail('all')} /><Metric label="НПВ" value={npvTotal} unit="ч" onClick={() => openDetail('npv')} /><Metric label="Циркуляция" value={hoursTotal} unit="ч" onClick={() => openDetail('hours')} /><Metric label="Отказы ТС" value={number.format(failures)} onClick={() => openDetail('failure')} /></div>
    {detail && <div className="ops-detail"><strong>{detail === 'all' ? 'Рейсы в фильтре' : detail === 'npv' ? 'Сумма значений НПВ, которые заполнены' : detail === 'hours' ? 'Сумма часов циркуляции, которые заполнены' : 'Рейсы с отказом ТС'}: {detail === 'all' ? filtered.length : detail === 'npv' ? `${npvTotal} ч` : detail === 'hours' ? `${hoursTotal} ч` : failures}</strong><span>{detail === 'npv' ? `Заполнено: ${npvValues.length} из ${filtered.length}` : detail === 'hours' ? `Заполнено: ${hourValues.length} из ${filtered.length}` : 'Числа рассчитаны по текущим фильтрам.'}</span></div>}
    <div className="ops-grid ops-visuals"><article className="ops-card ops-status-card"><div><h2>Распределение по статусу</h2><p>Нажмите статус, чтобы фильтровать</p></div><div className="ops-status-layout"><div className="ops-donut" style={donutStyle} role="img" aria-label={`Статусы рейсов: ${totalStatus}`}><span><b>{number.format(totalStatus)}</b><small>рейсов</small></span></div><div className="ops-legend">{statuses.map((label, i) => <button type="button" key={label} aria-pressed={statusFilter === label} onClick={() => setStatusFilter(cur => cur === label ? '' : label)}><i className={`dot dot-${i}`} /><span>{label}</span><b>{number.format(counts[i])}</b><small>{number.format(shares[i])}%</small></button>)}</div></div></article><article className="ops-card ops-month-card"><div className="ops-card-title"><div><h2>Рейсы по месяцам</h2><p>Дата начала по фильтрам</p></div>{monthFilter && <button type="button" className="ops-clear-month" onClick={() => setMonthFilter('')}>Сбросить месяц</button>}</div>{monthly.length ? <div className="ops-bars" role="group" aria-label="Рейсы по месяцам">{monthly.map(([month, count]) => <button type="button" key={month} aria-pressed={monthFilter === month} aria-label={`${month}: ${count}`} onClick={() => setMonthFilter(cur => cur === month ? '' : month)}><b>{count}</b><i style={{ height: `${Math.max(4, count / maxMonth * 100)}%` }} /><span>{month}</span></button>)}</div> : <p className="dash-empty">Нет дат для динамики.</p>}</article></div>
    <article className="ops-card ops-attention"><div className="ops-table-head"><div><h2>Рейсы, требующие внимания</h2><p>Рейсы с НПВ или зарегистрированным отказом ТС</p></div><span>{attention.length} / 5</span></div>{attention.length ? <div className="ops-attention-list">{attention.map((row, i) => <button type="button" className="ops-trip" key={row.id ?? i} onClick={() => openTrip(row)}><span className={`ops-status ops-status-${statusClass(display(raw(row, status)))}`}>{display(raw(row, status))}</span><strong>{tripLabel(row)}</strong><span>НПВ <b>{npvLabel(row)}</b></span><span>{raw(row, failure) === true ? 'Отказ ТС: да' : 'Отказ ТС: нет'}</span><span className="ops-trip-open">Открыть</span></button>)}</div> : <p className="dash-empty">рейсов для внимания нет.</p>}</article>
    <div className="ops-all-head"><h2>Реестр рейсов <span>({number.format(filtered.length)})</span></h2><button type="button" className="ops-reset" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? 'Скрыть реестр' : 'Показать рейсы'}</button></div>
    {showAll && <article className="ops-card ops-risks">{filtered.length ? <table><thead><tr><th>Рейс</th><th>Дата</th><th>Статус</th><th>НПВ</th><th>Циркуляция</th><th>Отказ ТС</th><th></th></tr></thead><tbody>{filtered.map((row, i) => <tr key={row.id ?? i} onClick={() => openTrip(row)}><td>{tripLabel(row)}</td><td>{dateValue(raw(row, started)) || '—'}</td><td>{display(raw(row, status))}</td><td>{npvLabel(row)}</td><td>{numeric(raw(row, hours)) === null ? '—' : `${number.format(numeric(raw(row, hours)))} ч`}</td><td>{raw(row, failure) === true ? 'Да' : raw(row, failure) === false ? 'Нет' : '—'}</td><td>{onOpen && <button type="button" className="ops-open" onClick={e => { e.stopPropagation(); openTrip(row) }}>Открыть</button>}</td></tr>)}</tbody></table> : <p className="dash-empty">рейсов нет.</p>}</article>}
  </section>
}
