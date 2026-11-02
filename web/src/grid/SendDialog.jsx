import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { displayValue } from './cells.js'

const MAX_TO = 15   // как в Airtable
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/

// как в письме: флажок — «✓» или пусто, остальное — как в сетке
const show = (f, v) => (typeof v === 'boolean' ? (v ? '✓' : '—') : displayValue(f, v))

function plural(n) {
  const a = n % 10, b = n % 100
  return a === 1 && b !== 11 ? 'запись' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'записи' : 'записей'
}

// «Отправить запись», как Send record Airtable: кому, тема, сообщение, предпросмотр письма,
// «Табличный вид» (записи строками таблицы). Письмо собирает сервер — тут только показ.
export default function SendDialog({ tableId, table, rows, columns, fields, user, onClose }) {
  const n = rows.length
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState(`${user?.name || user?.login || 'Коллега'} отправил(а) ${n} ${plural(n)} из таблицы «${table}»`)
  const [message, setMessage] = useState(`Актуальная версия ${n === 1 ? 'записи' : 'записей'} из таблицы «${table}»:`)
  const [grid, setGrid] = useState(false)
  const [mail, setMail] = useState(null)   // настроена ли почта на сервере
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => { api('/api/mail/status').then(setMail).catch(() => setMail({ configured: false })) }, [])
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const shown = columns.map(c => fields.find(f => f.column_name === c)).filter(Boolean)
  const list = to.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
  const bad = list.filter(x => !EMAIL.test(x))
  const canSend = mail?.configured && list.length > 0 && list.length <= MAX_TO && !bad.length && subject.trim() && !busy

  async function send(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await api(`/api/tables/${tableId}/send`, { method: 'POST',
        body: { ids: rows.map(r => r.id), columns, to: list, subject, message, grid } })
      setDone(true)
    } catch (err) {
      setError(typeof err.body?.detail === 'string' ? err.body.detail : 'Не удалось отправить письмо')
    } finally { setBusy(false) }
  }

  return (
    <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="send" role="dialog" aria-modal="true" aria-label={n === 1 ? 'Отправить запись' : 'Отправить записи'} onSubmit={send}>
        <button type="button" className="send-x" aria-label="Закрыть" onClick={onClose}>×</button>
        <h2>{n === 1 ? 'Отправить запись' : `Отправить ${n} ${plural(n)}`}</h2>
        {mail && !mail.configured && (
          <div className="send-warn" role="status">Почта не настроена: администратору нужно указать почтовый сервер (SMTP) в настройках сервера. Письмо можно подготовить, но не отправить.</div>
        )}
        {done ? (
          <>
            <p className="send-done" role="status">Письмо отправлено: {list.join(', ')}</p>
            <div className="send-foot"><button type="button" className="btn primary" autoFocus onClick={onClose}>Готово</button></div>
          </>
        ) : (
          <>
            <label className="send-lbl" htmlFor="send-to">Кому</label>
            <input id="send-to" className="fld-input" autoFocus value={to} onChange={e => setTo(e.target.value)}
              placeholder={`Адреса через запятую, не больше ${MAX_TO}`} aria-invalid={bad.length > 0 || list.length > MAX_TO} />
            {bad.length > 0 && <div className="err">Неверный адрес: {bad.join(', ')}</div>}
            {list.length > MAX_TO && <div className="err">Не больше {MAX_TO} адресов</div>}
            <label className="send-lbl" htmlFor="send-subj">Тема</label>
            <input id="send-subj" className="fld-input" value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} />
            <label className="send-lbl" htmlFor="send-msg">Сообщение</label>
            <textarea id="send-msg" className="fld-input fld-area" rows={2} maxLength={5000} value={message} onChange={e => setMessage(e.target.value)} />
            <div className="send-preview" aria-label="Предпросмотр письма">
              {grid ? (
                <table>
                  <thead><tr>{shown.map(f => <th key={f.column_name}>{f.title}</th>)}</tr></thead>
                  <tbody>{rows.map(r => <tr key={r.id}>{shown.map(f => <td key={f.column_name}>{show(f, r[f.column_name])}</td>)}</tr>)}</tbody>
                </table>
              ) : rows.map(r => (
                <div key={r.id} className="send-rec">
                  {shown.map((f, i) => (
                    <div key={f.column_name} className={i === 0 ? 'send-title' : undefined}>
                      <small>{f.title}</small><div>{show(f, r[f.column_name])}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <label className="send-toggle"><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} />Табличный вид</label>
            {error && <div className="err" role="alert">{error}</div>}
            <div className="send-foot">
              <button type="button" className="btn" onClick={onClose}>Отмена</button>
              <button type="submit" className="btn primary" disabled={!canSend}>{busy ? 'Отправка…' : 'Отправить'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
