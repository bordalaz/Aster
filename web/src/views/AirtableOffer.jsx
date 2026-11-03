import { useEffect, useState } from 'react'
import { api } from '../api.js'

// Личные виды из Airtable — автору на выбор, один раз (решение владельца): отмеченные становятся
// его личными видами; «Не нужно» — больше не спрашиваем; «Позже» — спросим при следующем входе.
export default function AirtableOffer() {
  const [views, setViews] = useState(null)
  const [pick, setPick] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/api/views/airtable/offer').then(vs => { setViews(vs); setPick(new Set(vs.map(v => v.id))) }, () => setViews([]))
  }, [])
  if (!views?.length) return null

  async function send(ids) {
    setBusy(true); setError('')
    try { await api('/api/views/airtable/offer', { method: 'POST', body: { ids } }); setViews([]); if (ids.length) window.location.reload() }
    catch { setError('Не удалось — попробуйте ещё раз') }
    finally { setBusy(false) }
  }
  const tables = [...new Set(views.map(v => v.table))]
  const toggle = id => setPick(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="card-backdrop">
      <div className="send" role="dialog" aria-modal="true" aria-label="Ваши виды из Airtable">
        <h2>Ваши виды из Airtable</h2>
        <p className="at-offer-lead">В Airtable у вас было {views.length} личных видов. Отметьте, какие перенести — они появятся в «Моих личных видах» своих таблиц.</p>
        <div className="at-offer-list">
          {tables.map(t => (
            <fieldset key={t}>
              <legend>{t}</legend>
              {views.filter(v => v.table === t).map(v => (
                <label key={v.id}><input type="checkbox" checked={pick.has(v.id)} onChange={() => toggle(v.id)} />{v.title}</label>
              ))}
            </fieldset>
          ))}
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="send-foot">
          <button type="button" className="btn" disabled={busy} onClick={() => send([])}>Не нужно</button>
          <button type="button" className="btn" disabled={busy} onClick={() => setViews([])}>Позже</button>
          <button type="button" className="btn primary" disabled={busy || !pick.size} onClick={() => send([...pick])}>Перенести ({pick.size})</button>
        </div>
      </div>
    </div>
  )
}
