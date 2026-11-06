import { useMemo, useState } from 'react'
import './TripsDashboard.css'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const statuses = ['В работе', 'Планируется', 'Закончен']
const field = (fields, title) => Object.entries(fields || {}).find(([, item]) => item.title === title)?.[0]
const raw = (row, column) => column ? row?.[column] : null
const scalar = item => item && typeof item === 'object' ? item.name ?? item.title ?? item.id ?? '' : item
const display = item => item === null || item === undefined || item === '' ? '—' : String(scalar(item))
const dateValue = value => {
  if (!value) return ''
  const text = String(value)
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text.slice(0, 10) : date.toISOString().slice(0, 10)
}
const list = value => (Array.isArray(value) ? value : value ? [value] : []).map(scalar).filter(x => x !== '').map(String)
const uniqueOptions = (rows, column) => [...new Set(rows.flatMap(row => list(raw(row, column))))].sort((a, b) => a.localeCompare(b, 'ru'))
const numeric = value => {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`

function Metric({ label, children }) {
  return <article className="ops-metric" aria-label={label}><span>{label}</span><strong>{children}</strong></article>
}

export default function TripsDashboard({ fields, rows = [], onOpen }) {
  const col = title => field(fields, title)
  const started = col('Начало')
  const trip = col('ID_Рейса_APS')
  const status = col('Статус')
  const hours = col('Циркуляция, час')
  const npv = col('Время НПВ')
  const failure = col('Отказ ТС')
  const work = col('ID_Работа')
  const engineer = col('ID_Инженеры')
  const customer = col('Заказчик') || col('ID_Заказчик')
  const note = col('Примечание')
  const year = new Date().getFullYear()
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(`${year}-12-31`)
  const [statusFilter, setStatusFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [engineerFilter, setEngineerFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [sort, setSort] = useState({ key: started || 'id', direction: 'desc' })

  const filtered = useMemo(() => rows.filter(row => {
    const date = dateValue(raw(row, started))
    if (from && (!date || date < from)) return false
    if (to && (!date || date > to)) return false
    if (statusFilter && display(raw(row, status)) !== statusFilter) return false
    if (customerFilter && !list(raw(row, customer)).includes(customerFilter)) return false
    if (engineerFilter && !list(raw(row, engineer)).includes(engineerFilter)) return false
    if (monthFilter && date.slice(0, 7) !== monthFilter) return false
    return true
  }), [rows, started, from, to, statusFilter, customerFilter, engineerFilter, monthFilter, status, customer, engineer])

  const monthly = useMemo(() => {
    const counts = new Map()
    rows.filter(row => {
      const date = dateValue(raw(row, started))
      return (!from || date >= from) && (!to || date <= to) && (!statusFilter || display(raw(row, status)) === statusFilter) && (!customerFilter || list(raw(row, customer)).includes(customerFilter)) && (!engineerFilter || list(raw(row, engineer)).includes(engineerFilter))
    }).forEach(row => {
      const month = dateValue(raw(row, started)).slice(0, 7)
      if (month) counts.set(month, (counts.get(month) || 0) + 1)
    })
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [rows, started, from, to, statusFilter, customerFilter, engineerFilter, status, customer, engineer])
  const maxMonth = Math.max(1, ...monthly.map(([, count]) => count))
  const npvValues = filtered.map(row => numeric(raw(row, npv))).filter(value => value !== null)
  const npvTotal = npvValues.length ? number.format(npvValues.reduce((total, value) => total + value, 0)) : 'Нет данных'
  const activeRows = filtered.filter(row => display(raw(row, status)) === 'В работе')
  const activeWorks = new Set(activeRows.flatMap(row => {
    const value = raw(row, work)
    return (Array.isArray(value) ? value : value ? [value] : []).map(item => item && typeof item === 'object' ? item.id : item).filter(item => item !== null && item !== undefined && item !== '')
  }).map(String)).size
  const failures = filtered.filter(row => Boolean(raw(row, failure))).length
  const hourValues = filtered.map(row => numeric(raw(row, hours))).filter(value => value !== null)
  const hoursTotal = hourValues.length ? `${number.format(hourValues.reduce((total, value) => total + value, 0))} ч` : 'Нет данных'
  const sorted = [...filtered].sort((a, b) => {
    const av = sort.key === 'date' ? dateValue(raw(a, started)) : sort.key === 'customer' ? list(raw(a, customer)).join(', ') : sort.key === 'engineer' ? list(raw(a, engineer)).join(', ') : raw(a, sort.key)
    const bv = sort.key === 'date' ? dateValue(raw(b, started)) : sort.key === 'customer' ? list(raw(b, customer)).join(', ') : sort.key === 'engineer' ? list(raw(b, engineer)).join(', ') : raw(b, sort.key)
    const an = numeric(av), bn = numeric(bv)
    const result = an !== null && bn !== null ? an - bn : String(scalar(av) ?? '').localeCompare(String(scalar(bv) ?? ''), 'ru', { numeric: true })
    return result * (sort.direction === 'asc' ? 1 : -1)
  })
  const reset = () => { setFrom(`${year}-01-01`); setTo(`${year}-12-31`); setStatusFilter(''); setCustomerFilter(''); setEngineerFilter(''); setMonthFilter('') }
  const toggleSort = (key, column) => setSort(current => ({ key: column || key, direction: current.key === (column || key) && current.direction === 'asc' ? 'desc' : 'asc' }))
  const exportCsv = () => {
    const columns = [['Рейс', trip], ['Дата', started], ['Статус', status], ['Заказчик', customer], ['Инженер', engineer], ['Циркуляция, час', hours], ['Время НПВ', npv], ['Отказ ТС', failure], ['Примечание', note]]
    const content = '\uFEFF' + [columns.map(([title]) => csvCell(title)).join(';'), ...sorted.map(row => columns.map(([, key]) => csvCell(Array.isArray(raw(row, key)) ? list(raw(row, key)).join(', ') : display(raw(row, key)))).join(';'))].join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'reysy-aps.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  const sortLabel = key => sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''

  return <section className="ops-dashboard" aria-label="Аналитика рейсов APS">
    <header className="ops-head"><div><h1>Рейсы APS</h1><p>Аналитика рейсов, работ и времени</p></div><button type="button" className="ops-export" onClick={exportCsv}>Экспорт CSV</button></header>
    <section className="ops-filters" aria-label="Фильтры рейсов">
      <label>С даты<input aria-label="С даты" type="date" value={from} onChange={event => { setFrom(event.target.value); setMonthFilter('') }} /></label>
      <label>По дату<input aria-label="По дату" type="date" value={to} onChange={event => { setTo(event.target.value); setMonthFilter('') }} /></label>
      <label>Статус<select aria-label="Статус" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Все статусы</option>{statuses.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Заказчик<select aria-label="Заказчик" value={customerFilter} onChange={event => setCustomerFilter(event.target.value)}><option value="">Все заказчики</option>{uniqueOptions(rows, customer).map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Инженер<select aria-label="Инженер" value={engineerFilter} onChange={event => setEngineerFilter(event.target.value)}><option value="">Все инженеры</option>{uniqueOptions(rows, engineer).map(item => <option key={item}>{item}</option>)}</select></label>
      <button type="button" className="ops-reset" onClick={reset}>Сбросить</button>
    </section>
    <div className="ops-metrics">
      <Metric label="Всего рейсов">{number.format(filtered.length)}</Metric>
      <Metric label="Активные работы">{number.format(activeWorks)}</Metric>
      <Metric label="НПВ">{npvTotal}{npvValues.length ? ' ч' : ''}</Metric>
      <Metric label="Отказы ТС">{number.format(failures)}</Metric>
    </div>
    <div className="ops-grid">
      <article className="ops-card"><h2>Рейсы по месяцам</h2>{monthly.length ? <div className="ops-bars" role="group" aria-label="Рейсы по месяцам">{monthly.map(([month, count]) => <button type="button" key={month} aria-pressed={monthFilter === month} aria-label={`${month}: ${count} рейсов`} onClick={() => setMonthFilter(current => current === month ? '' : month)}><i style={{ height: `${Math.max(6, count / maxMonth * 100)}%` }} /><b>{count}</b><span>{new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))}</span></button>)}</div> : <p className="dash-empty">Нет рейсов в выбранном периоде.</p>}</article>
      <article className="ops-card"><h2>Состояние периода</h2><dl className="ops-summary"><div><dt>Циркуляция</dt><dd>{hoursTotal}</dd></div><div><dt>Рейсы с отказом ТС</dt><dd>{number.format(failures)}</dd></div><div><dt>В работе</dt><dd>{number.format(activeRows.length)}</dd></div><div><dt>Планируется</dt><dd>{number.format(filtered.filter(row => display(raw(row, status)) === 'Планируется').length)}</dd></div><div><dt>Закончен</dt><dd>{number.format(filtered.filter(row => display(raw(row, status)) === 'Закончен').length)}</dd></div></dl></article>
    </div>
    <article className="ops-card ops-risks"><div className="ops-table-head"><h2>Все рейсы <span>({number.format(filtered.length)})</span></h2>{monthFilter && <button type="button" onClick={() => setMonthFilter('')}>Очистить фильтр месяца</button>}</div>
      {sorted.length ? <table><thead><tr><th><button onClick={() => toggleSort('trip', trip)}>Рейс{sortLabel(trip)}</button></th><th><button onClick={() => toggleSort('date', 'date')}>Дата{sortLabel('date')}</button></th><th><button onClick={() => toggleSort('status', status)}>Статус{sortLabel(status)}</button></th><th><button onClick={() => toggleSort('customer', 'customer')}>Заказчик{sortLabel('customer')}</button></th><th><button onClick={() => toggleSort('engineer', 'engineer')}>Инженер{sortLabel('engineer')}</button></th><th><button onClick={() => toggleSort('hours', hours)}>Циркуляция{sortLabel(hours)}</button></th><th><button onClick={() => toggleSort('npv', npv)}>НПВ{sortLabel(npv)}</button></th><th>Отказ ТС</th><th>Примечание</th><th>Открыть</th></tr></thead><tbody>{sorted.map((row, index) => <tr key={row.id ?? index}><td>{display(raw(row, trip))}</td><td>{dateValue(raw(row, started)) || '—'}</td><td><span className={`ops-status ops-status-${display(raw(row, status)) === 'В работе' ? 'active' : display(raw(row, status)) === 'Планируется' ? 'planned' : 'done'}`}>{display(raw(row, status))}</span></td><td>{list(raw(row, customer)).join(', ') || '—'}</td><td>{list(raw(row, engineer)).join(', ') || '—'}</td><td>{numeric(raw(row, hours)) === null ? '—' : `${number.format(numeric(raw(row, hours)))} ч`}</td><td>{numeric(raw(row, npv)) === null ? '—' : `${number.format(numeric(raw(row, npv)))} ч`}</td><td>{raw(row, failure) ? 'Да' : raw(row, failure) === false ? 'Нет' : '—'}</td><td>{display(raw(row, note))}</td><td>{onOpen && <button type="button" className="ops-open" onClick={() => onOpen(row.id)}>Открыть</button>}</td></tr>)}</tbody></table> : <p className="dash-empty">Нет рейсов по выбранным фильтрам.</p>}
    </article>
  </section>
}
