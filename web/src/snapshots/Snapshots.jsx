import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon } from '../ui/icons.jsx'

const when = s => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const KIND = { auto: 'Автоматический', manual: 'Вручную', before_restore: 'Перед откатом' }
const JOB = { snapshot: 'Снимок', open: 'Открыть снимок', restore: 'Вернуть базу' }
const size = b => (b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} МБ` : `${Math.round(b / 1e3)} КБ`)
const err = (e, d) => (typeof e.body?.detail === 'string' ? e.body.detail : d)
// веб снимка — тот же хост, порт 5201 (npm run dev:snapshot), если сервер не задал свой адрес
const snapUrl = u => u || `${location.protocol}//${location.hostname}:5201/`

// Снимки базы, как в Airtable: сами раз в сутки и по кнопке, хранятся год. «Открыть» — копия только для
// чтения рядом с рабочей базой; «Вернуть базу» (суперадмин) — рабочая база целиком как в момент снимка,
// перед этим система сама снимает текущее состояние, так что откат можно отменить.
export default function Snapshots() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [sure, setSure] = useState(null)   // снимок для подтверждения «Вернуть базу»

  const load = useCallback(async () => {
    try { setData(await api('/api/snapshots')); setError('') } catch (e) { setError(err(e, 'Не удалось открыть снимки')) }
  }, [])
  const busy = data?.jobs.some(j => j.status === 'pending' || j.status === 'running')
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!busy) return undefined; const t = setInterval(load, 3000); return () => clearInterval(t) }, [busy, load])

  async function act(path, body) {
    setError(''); setSure(null)
    try { await api(path, { method: 'POST', body }); await load() } catch (e) { setError(err(e, 'Не удалось')) }
  }

  if (!data) return <section className="trash" aria-label="Снимки">{error ? <div className="err" role="alert">{error}</div> : <p className="muted">Загрузка…</p>}</section>
  const job = data.jobs[0]
  return (
    <section className="trash" aria-label="Снимки">
      <header className="trash-head">
        <h1><Icon name="snapshot" size={20} />Снимки</h1>
        <span className="muted">Снимок базы делается сам раз в сутки и по кнопке, хранится год. «Открыть» — посмотреть базу на тот момент, рабочая не меняется.</span>
      </header>
      <div className="trash-filters">
        <button className="btn primary" disabled={busy} onClick={() => act('/api/snapshots')}><Icon name="plus" size={14} />Сделать снимок</button>
        {data.open && <a className="btn" href={snapUrl(data.snapshot_url)} target="_blank" rel="noreferrer"><Icon name="eye" size={14} />Открытый снимок #{data.open}</a>}
      </div>
      {job && (
        <div className={job.status === 'failed' ? 'err' : 'muted'} role="status" style={{ margin: '0 0 12px' }}>
          {JOB[job.kind]}{job.snapshot_id ? ` #${job.snapshot_id}` : ''}: {job.status === 'pending' ? 'в очереди…' : job.status === 'running' ? 'выполняется…' : job.message}
        </div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
      {data.snapshots.length === 0 ? (
        <div className="trash-empty"><Icon name="snapshot" size={32} /><strong>Снимков пока нет</strong></div>
      ) : (
        <table className="trash-list">
          <thead><tr><th>№</th><th>Когда</th><th>Как</th><th>Кто</th><th>Размер</th><th /></tr></thead>
          <tbody>
            {data.snapshots.map(s => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{when(s.created_at)}</td>
                <td>{KIND[s.kind] ?? s.kind}</td>
                <td>{s.by_user ?? '—'}</td>
                <td className="muted">{size(s.size)}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn" disabled={busy} onClick={() => act(`/api/snapshots/${s.id}/open`)}><Icon name="eye" size={14} />Открыть</button>
                  {data.can_restore && <button className="btn danger" disabled={busy} onClick={() => setSure(s)}><Icon name="undo" size={14} />Вернуть базу</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sure && (
        <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSure(null) }}>
          <div className="confirm" role="alertdialog" aria-modal="true" aria-label="Вернуть базу к снимку">
            <h2>Вернуть базу к снимку от {when(sure.created_at)}?</h2>
            <p>Вся рабочая база станет такой, как в момент снимка: всё, что изменили после, — записи, правки, комментарии,
              пользователи — пропадёт у всех. Перед откатом система сама снимет текущее состояние: вернуться можно будет так же.</p>
            <p className="muted" style={{ marginTop: 8 }}>Пока идёт откат, программа около минуты недоступна.</p>
            <div className="send-foot">
              <button type="button" className="btn" autoFocus onClick={() => setSure(null)}>Отмена</button>
              <button type="button" className="btn danger-fill" onClick={() => act(`/api/snapshots/${sure.id}/restore`, { confirm: true })}>Вернуть базу</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// Плашка на экземпляре снимка: какой снимок и что это только просмотр.
export function SnapshotBanner() {
  const [snap, setSnap] = useState(null)
  useEffect(() => { api('/api/snapshot-info').then(r => setSnap(r.snapshot)).catch(() => {}) }, [])
  if (!snap) return null
  return (
    <div className="snapshot-banner" role="status">
      <Icon name="snapshot" size={14} />
      Снимок{snap.id ? ` #${snap.id} от ${when(snap.created_at)}` : ''} — только просмотр. Рабочая база не меняется.
    </div>
  )
}
