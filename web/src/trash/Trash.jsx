import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import FieldEditor from '../card/fields.jsx'
import Comments from '../card/Comments.jsx'
import Files from '../files/Files.jsx'
import { fieldIcon, Icon } from '../ui/icons.jsx'

const when = s => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const day = s => new Date(s).toLocaleDateString('ru-RU')

// Корзина (решения владельца): общая для всех таблиц, только админам; что, откуда, кто и когда удалил,
// когда сотрётся (через год). Восстановить — админ; удалить навсегда — суперадмин. По щелчку — карточка для чтения.
export default function Trash({ user }) {
  const [items, setItems] = useState(null)
  const [tables, setTables] = useState([])
  const [table, setTable] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)   // id в корзине
  const [error, setError] = useState('')
  const [sure, setSure] = useState(null)   // {id, title} — подтвердить «удалить навсегда»
  const superadmin = user?.role === 'superadmin'

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ ...(table ? { table_id: table } : {}), ...(q.trim() ? { q: q.trim() } : {}) })
    try { setItems(await api(`/api/trash?${qs}`)) } catch { setError('Не удалось открыть корзину') }
  }, [table, q])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])
  useEffect(() => { api('/api/tables').then(setTables).catch(() => {}) }, [])

  async function restore(id) {
    setError('')
    try { await api('/api/trash/restore', { method: 'POST', body: { ids: [id] } }); setOpen(null); await load() }
    catch (e) { setError(typeof e.body?.detail === 'string' ? e.body.detail : 'Не удалось восстановить') }
  }
  async function purge(id) {
    setError(''); setSure(null)
    try { await api(`/api/trash/${id}`, { method: 'DELETE' }); setOpen(null); await load() }
    catch { setError('Не удалось удалить навсегда') }
  }

  return (
    <section className="trash" aria-label="Корзина">
      <header className="trash-head">
        <h1><Icon name="trash" size={20} />Корзина</h1>
        <span className="muted">Удалённые записи хранятся год, потом стираются сами. Восстановленная запись возвращается со связями, историей и комментариями.</span>
      </header>
      <div className="trash-filters">
        <select aria-label="Таблица" value={table} onChange={e => setTable(e.target.value)}>
          <option value="">Все таблицы</option>
          {tables.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <input type="search" aria-label="Поиск по названию" placeholder="Поиск по названию" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {items === null ? <p className="muted">Загрузка…</p> : items.length === 0 ? (
        <div className="trash-empty"><Icon name="trash" size={32} /><strong>Корзина пуста</strong></div>
      ) : (
        <table className="trash-list">
          <thead><tr><th>Запись</th><th>Таблица</th><th>Удалил</th><th>Когда</th><th>Сотрётся</th><th /></tr></thead>
          <tbody>{items.map(it => (
            <tr key={it.id}>
              <td><button type="button" className="trash-open" onClick={() => setOpen(it.id)}>{it.title || `Запись №${it.record_id}`}</button></td>
              <td>{it.table_title}</td>
              <td>{it.deleted_by ?? '—'}</td>
              <td className="num">{when(it.deleted_at)}</td>
              <td className="num muted">{day(it.expires_at)}</td>
              <td className="trash-actions">
                <button type="button" className="btn" onClick={() => restore(it.id)}>Восстановить</button>
                {superadmin && <button type="button" className="btn danger" onClick={() => setSure({ id: it.id, title: it.title })}>Удалить навсегда</button>}
              </td>
            </tr>))}</tbody>
        </table>
      )}
      {open && <TrashCard id={open} superadmin={superadmin} onClose={() => setOpen(null)} onRestore={() => restore(open)}
        onPurge={t => setSure({ id: open, title: t })} />}
      {sure && (
        <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSure(null) }}>
          <div className="confirm" role="alertdialog" aria-modal="true" aria-label="Удалить навсегда">
            <h2>Удалить навсегда?</h2>
            <p>«{sure.title || 'Запись'}» будет стёрта без возможности восстановления.</p>
            <div className="send-foot">
              <button type="button" className="btn" autoFocus onClick={() => setSure(null)}>Отмена</button>
              <button type="button" className="btn danger-fill" onClick={() => purge(sure.id)}>Удалить навсегда</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// Удалённая запись целиком, только для чтения: поля, история, комментарии. Править — после восстановления.
function TrashCard({ id, superadmin, onClose, onRestore, onPurge }) {
  const [rec, setRec] = useState(null)
  useEffect(() => { api(`/api/trash/${id}`).then(setRec).catch(() => onClose()) }, [id, onClose])
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  if (!rec) return null
  const fields = rec.fields.filter(f => f.column_name !== rec.primary_field && f.column_name in rec.values)
  const primary = rec.fields.find(f => f.column_name === rec.primary_field)
  const title = rec.title || `Запись №${rec.record_id}`
  return (
    <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-head">
          <span className="trash-badge"><Icon name="trash" size={14} />В корзине · {rec.table}</span>
          <span className="card-head-title muted">удалил {rec.deleted_by ?? '—'}, {when(rec.deleted_at)}</span>
          <button type="button" className="btn primary" style={{ marginLeft: 'auto' }} onClick={onRestore}>Восстановить</button>
          {superadmin && <button type="button" className="btn danger" onClick={() => onPurge(title)}>Удалить навсегда</button>}
          <button className="quiet" aria-label="Закрыть" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="card-main">
          <div className="card-body">
            {primary && <div className="card-primary"><Icon name={fieldIcon(primary.kind)} size={14} />{primary.title}</div>}
            <h2 className="card-title">{title}</h2>
            {fields.map(f => (f.kind === 'multipleAttachments' ? (
              <div key={f.column_name} className="fld fld-inline">
                <span className="fld-label"><Icon name={fieldIcon(f.kind)} size={14} />{f.title}</span>
                <div className="fld-value"><Files bare title={f.title} files={rec.values[f.column_name]} /></div>
              </div>
            ) : f.kind === 'multipleRecordLinks' ? (
              <div key={f.column_name} className="fld fld-inline">
                <span className="fld-label"><Icon name={fieldIcon(f.kind)} size={14} />{f.title}</span>
                <div className="fld-value fld-ro">{(rec.values[f.column_name] ?? []).length
                  ? rec.values[f.column_name].map(v => <span key={v.id} className="pill" style={{ background: '#e9eef6', borderRadius: 4, marginRight: 4 }}>{v.name || `№${v.id}`}</span>)
                  : '—'}</div>
              </div>
            ) : <FieldEditor key={f.column_name} inline field={{ ...f, editable: false }} value={rec.values[f.column_name]} />))}
          </div>
          <Comments tableId={rec.table_id} recordId={rec.record_id} fields={rec.fields} readOnly />
        </div>
      </div>
    </div>
  )
}
