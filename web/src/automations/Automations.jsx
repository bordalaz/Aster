import { useEffect, useState } from 'react'
import { api } from '../api.js'

// Экран «Автоматизации» (админы), как вкладка Automations в Airtable: список слева, справа — триггер,
// действие, вкл/выкл, настройки письма, «Запустить сейчас» (по расписанию) и журнал последних запусков.
const STATE = {
  live: on => (on ? ['Включена', 'on'] : ['Выключена', 'off']),
  buttons: () => ['Заменена кнопками', 'repl'],
  off: () => ['Выключена в Airtable', 'dead'],
}
const when = s => new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const list = s => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)

export default function Automations() {
  const [items, setItems] = useState(null)
  const [key, setKey] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api('/api/automations').then(xs => { setItems(xs); setKey(k => k ?? xs[0]?.key) }, () => setError('Не удалось загрузить'))
  useEffect(() => { load() }, [])

  if (!items) return <div style={{ padding: 16 }}>{error || 'Загрузка…'}</div>
  const a = items.find(x => x.key === key)
  const act = async (fn, okMsg) => {
    setBusy(true); setError('')
    try { const r = await fn(); if (r?.message) setError(r.ok ? '' : r.message); await load() }
    catch (e) { setError(typeof e.body?.detail === 'string' ? e.body.detail : okMsg) }
    finally { setBusy(false) }
  }

  return (
    <div className="au">
      <nav className="au-list" aria-label="Автоматизации">
        {items.map(x => {
          const [label, cls] = STATE[x.state](x.enabled)
          return (
            <button key={x.key} className="form-item" aria-pressed={x.key === key} onClick={() => { setKey(x.key); setError('') }}>
              {x.title}<small><span className={`au-dot ${cls}`} />{label} · {x.table}</small>
            </button>
          )
        })}
      </nav>
      {a && (
        <section className="au-main" aria-label={a.title}>
          <h2>{a.title}</h2>
          {a.state === 'live' && (
            <label className="au-toggle">
              <input type="checkbox" checked={a.enabled} disabled={busy}
                onChange={e => act(() => api(`/api/automations/${a.key}`, { method: 'PATCH', body: { enabled: e.target.checked } }), 'Не удалось переключить')} />
              {a.enabled ? 'Включена' : 'Выключена'}
            </label>
          )}
          <dl className="au-dl">
            <dt>Когда</dt><dd>{a.trigger}</dd>
            <dt>Что делает</dt><dd>{a.action}</dd>
          </dl>
          {a.note && <p className="au-note">{a.note}</p>}
          {a.key === 'mail_peremeshcheniya' && <MailSettings a={a} busy={busy}
            onSave={s => act(() => api(`/api/automations/${a.key}`, { method: 'PATCH', body: { settings: s } }), 'Не удалось сохранить')} />}
          {a.scheduled && a.state === 'live' && (
            <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/automations/${a.key}/run`, { method: 'POST' }), 'Запуск не удался')}>
              Запустить сейчас
            </button>
          )}
          {error && <div className="err" role="alert">{error}</div>}
          {a.state === 'live' && (
            <>
              <h3>Последние запуски</h3>
              {a.runs.length === 0 ? <p className="au-note">Запусков ещё не было</p> : (
                <table className="au-runs">
                  <tbody>
                    {a.runs.map((r, i) => (
                      <tr key={i}><td>{when(r.at)}</td><td className={r.ok ? 'ok' : 'bad'}>{r.ok ? '✓' : '✗'}</td>
                        <td>{r.message}{r.record_id ? ` (запись №${r.record_id})` : ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}

function MailSettings({ a, busy, onSave }) {
  const s = a.settings ?? {}
  const [to, setTo] = useState((s.to ?? []).join(', '))
  const [cc, setCc] = useState((s.cc ?? []).join(', '))
  const [from, setFrom] = useState(s.from_name ?? '')
  return (
    <form className="au-mail" onSubmit={e => { e.preventDefault(); onSave({ to: list(to), cc: list(cc), from_name: from.trim() }) }}>
      <label>Кому<input className="fld-input" value={to} onChange={e => setTo(e.target.value)} placeholder="адреса через запятую" /></label>
      <label>Копия<input className="fld-input" value={cc} onChange={e => setCc(e.target.value)} placeholder="адреса через запятую" /></label>
      <label>Имя отправителя<input className="fld-input" value={from} maxLength={100} onChange={e => setFrom(e.target.value)} /></label>
      <div><button className="btn" type="submit" disabled={busy}>Сохранить получателей</button></div>
    </form>
  )
}
