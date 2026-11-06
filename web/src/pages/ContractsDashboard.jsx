import { useMemo, useState } from 'react'
import './ContractsDashboard.css'

const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const field = (fields, title) => Object.entries(fields || {}).find(([, f]) => f.title === title)?.[0]
const value = (row, col) => col ? row?.[col] : null
const numeric = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
const scalar = v => v && typeof v === 'object' ? v.name ?? v.title ?? v.id ?? '' : v
const text = v => v === null || v === undefined || v === '' ? '—' : String(scalar(v))
const list = v => (Array.isArray(v) ? v : v ? [v] : []).map(scalar).filter(x => x !== '').map(String)
const date = v => { if (!v) return ''; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10) }
const options = (rows, col) => [...new Set(rows.flatMap(r => list(value(r, col))))].sort((a, b) => a.localeCompare(b, 'ru'))
const money = v => v === null ? '—' : `${fmt.format(v)} ₽`

export function summarizeContracts(rows, columns, today = new Date()) {
  const selected = rows
  const sumColumn = col => {
    const found = selected.map(r => numeric(value(r, col))).filter(v => v !== null)
    return found.length ? found.reduce((a, b) => a + b, 0) : null
  }
  const grouped = new Map()
  for (const row of selected) {
    const number = text(value(row, columns.number))
    const key = number === '—' ? `Без номера · ${row.id ?? grouped.size + 1}` : number
    const item = grouped.get(key) ?? { key, rows: [], remaining: null, expiration: '' }
    item.rows.push(row)
    const amount = numeric(value(row, columns.remaining))
    if (amount !== null) item.remaining = (item.remaining ?? 0) + amount
    const expiry = date(value(row, columns.expiration))
    if (expiry && (!item.expiration || expiry < item.expiration)) item.expiration = expiry
    grouped.set(key, item)
  }
  const todayKey = date(today)
  const soonCount = selected.filter(row => {
    const expiry = date(value(row, columns.expiration))
    return expiry && expiry >= todayKey && expiry <= new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10)
  }).length
  const overdue = [...grouped.values()].filter(x => x.expiration && x.expiration < todayKey).sort((a, b) => a.expiration.localeCompare(b.expiration)).slice(0, 5)
  return {
    limit: sumColumn(columns.limit),
    invoiced: [sumColumn(columns.invoice20), sumColumn(columns.invoice23)].some(v => v !== null)
      ? (sumColumn(columns.invoice20) ?? 0) + (sumColumn(columns.invoice23) ?? 0) : null,
    remaining: sumColumn(columns.remaining),
    negativeCount: selected.filter(r => (numeric(value(r, columns.remaining)) ?? 0) < 0).length,
    grouped: [...grouped.values()], soonCount, overdue,
  }
}

function Metric({ title, value, note }) {
  return <article className="contracts-metric"><span>{title}</span><strong>{value}</strong><small>{note}</small></article>
}

export default function ContractsDashboard({ fields = {}, rows = [], onOpen }) {
  const col = title => field(fields, title)
  const c = {
    code: col('Код_Договора'), number: col('№ Договора'), type: col('Тип'), status: col('Статус'),
    contractor: col('Подрядчики'), account: col('Счет'), subject: col('Предмет договора'),
    limit: col('Сумма договора, руб'), remaining: col('Остаток, руб'), invoice20: col('Сумма по счф 20, руб'),
    invoice23: col('Сумма по счф 23, руб'), expiration: col('Срок действия'), signed: col('Дата заключения'), parent: col('ID_Договор'),
  }
  const [status, setStatus] = useState('Действующий')
  const [contractor, setContractor] = useState(''), [account, setAccount] = useState(''), [type, setType] = useState('')
  const [showTable, setShowTable] = useState(false)
  const filtered = useMemo(() => rows.filter(r => (!status || text(value(r, c.status)) === status) && (!contractor || list(value(r, c.contractor)).includes(contractor)) && (!account || text(value(r, c.account)) === account) && (!type || text(value(r, c.type)) === type)), [rows, status, contractor, account, type, c.status, c.contractor, c.account, c.type])
  const data = useMemo(() => summarizeContracts(filtered, c), [filtered, c.limit, c.invoice20, c.invoice23, c.remaining, c.number, c.expiration])
  const top = [...data.grouped].filter(x => x.remaining !== null).sort((a, b) => b.remaining - a.remaining).slice(0, 8)
  const max = Math.max(1, ...top.map(x => Math.abs(x.remaining)))
  const clear = () => { setStatus('Действующий'); setContractor(''); setAccount(''); setType('') }
  const open = row => onOpen?.(row.id)
  const today = date(new Date())
  return <section className="contracts-dashboard" aria-label="Аналитика договоров">
    <header className="contracts-head"><div><span className="contracts-kicker">ФИНАНСОВЫЙ ОБЗОР</span><h1>Договоры и остатки</h1><p>Лимиты документов, счета фактуры и сроки действия</p></div><div className="contracts-head-actions"><span className="contracts-count">{fmt.format(filtered.length)} документов</span><button type="button" className="contracts-print" onClick={() => window.print()}>Печать / PDF</button></div></header>
    <div className="contracts-filters" aria-label="Фильтры договоров">
      <label>Статус<select aria-label="Статус" value={status} onChange={e => setStatus(e.target.value)}><option value="">Все статусы</option>{options(rows, c.status).map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Подрядчик<select aria-label="Подрядчик" value={contractor} onChange={e => setContractor(e.target.value)}><option value="">Все подрядчики</option>{options(rows, c.contractor).map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Счет<select aria-label="Счет" value={account} onChange={e => setAccount(e.target.value)}><option value="">Все счета</option>{options(rows, c.account).map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Тип документа<select aria-label="Тип документа" value={type} onChange={e => setType(e.target.value)}><option value="">Все типы</option>{options(rows, c.type).map(x => <option key={x}>{x}</option>)}</select></label>
      <button type="button" className="contracts-reset" onClick={clear}>Сбросить</button>
    </div>
    <div className="contracts-print-summary"><strong>Параметры отчёта</strong><span>Статус: {status || 'все'}</span><span>Подрядчик: {contractor || 'все'}</span><span>Счет: {account || 'все'}</span><span>Тип: {type || 'все'}</span><span>Документов: {fmt.format(filtered.length)}</span></div>
    <div className="contracts-metrics">
      <Metric title="Лимиты документов" value={money(data.limit)} note="Сумма по выбранным договорам и ДС" />
      <Metric title="Выставлено по счф" value={money(data.invoiced)} note="Счф 20 + счф 23, заполненные значения" />
      <Metric title="Остаток" value={money(data.remaining)} note="Сумма поля остатка по документам" />
      <Metric title="Документы с минусовым остатком" value={fmt.format(data.negativeCount)} note="Остаток меньше нуля" />
    </div>
    <div className="contracts-grid">
      <article className="contracts-card contracts-chart"><div className="contracts-card-head"><div><h2>Остатки по документам</h2><p>Сгруппировано по № договора; значения ДС учтены отдельно</p></div><span>до 8 позиций</span></div>
        {top.length ? <div className="contracts-bars" role="group" aria-label="Остатки по документам">{top.map(item => <button type="button" key={item.key} onClick={() => item.rows[0] && open(item.rows[0])} title={`${item.key}: ${money(item.remaining)}`}><span className="contracts-bar-label">{item.key}</span><span className="contracts-bar-track"><i className={item.remaining < 0 ? 'negative' : ''} style={{ width: `${Math.max(2, Math.abs(item.remaining) / max * 100)}%` }} /></span><b>{money(item.remaining)}</b></button>)}</div> : <p className="contracts-empty">Нет заполненных остатков для диаграммы.</p>}
      </article>
      <article className="contracts-card contracts-expiry"><div className="contracts-card-head"><div><h2>Контроль сроков</h2><p>Просроченные сгруппированы по договору, дата — ближайший срок документов группы</p></div></div><div className="contracts-expiry-count"><strong>{data.soonCount}</strong><span>документов истекают в ближайшие 30 дней</span></div>
        <h3>Просроченные документы</h3>{data.overdue.length ? <div className="contracts-overdue">{data.overdue.map(x => <button type="button" key={x.key} onClick={() => open(x.rows[0])}><strong>{x.key}</strong><span>{x.expiration}</span><small>{text(value(x.rows[0], c.contractor))}</small></button>)}</div> : <p className="contracts-empty">Просроченных сроков нет.</p>}
      </article>
    </div>
    <div className="contracts-register-head"><div><h2>Реестр документов</h2><span>{fmt.format(filtered.length)} записей</span></div><button type="button" className="contracts-reset" aria-expanded={showTable} onClick={() => setShowTable(x => !x)}>{showTable ? 'Скрыть реестр' : 'Показать реестр'}</button></div>
    {showTable && <article className="contracts-card contracts-table-wrap">{filtered.length ? <table><thead><tr><th>№ договора</th><th>Тип</th><th>Статус</th><th>Подрядчик</th><th>Счет</th><th>Предмет договора</th><th>Лимит, ₽</th><th>Остаток, ₽</th><th>Срок действия</th><th>Родительский договор</th></tr></thead><tbody>{filtered.map((r, i) => <tr key={r.id ?? i}><td><button type="button" className="contracts-link" onClick={() => open(r)}>{text(value(r, c.number))}</button><small>{text(value(r, c.code))}</small></td><td>{text(value(r, c.type))}</td><td>{text(value(r, c.status))}</td><td>{text(value(r, c.contractor))}</td><td>{text(value(r, c.account))}</td><td>{text(value(r, c.subject))}</td><td>{money(numeric(value(r, c.limit)))}</td><td>{money(numeric(value(r, c.remaining)))}</td><td>{date(value(r, c.expiration)) || '—'}</td><td>{value(r, c.parent) ? <button className="contracts-link" type="button" onClick={() => onOpen?.(Number(scalar(value(r, c.parent))))}>{text(value(r, c.parent))}</button> : '—'}</td></tr>)}</tbody></table> : <p className="contracts-empty">Нет документов по выбранным фильтрам.</p>}</article>}
    {!filtered.length && <p className="contracts-empty contracts-no-results">Нет документов по выбранным фильтрам.</p>}
  </section>
}
