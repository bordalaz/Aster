import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon } from '../ui/icons.jsx'

const when = at => new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

// Комментарии к записи — правая панель карточки, как в Airtable. Пишет всякий, кому видна таблица.
// readOnly — удалённая запись в корзине: комментарии видны, писать и удалять нельзя
export default function Comments({ tableId, recordId, readOnly = false }) {
  const url = `/api/tables/${tableId}/records/${recordId}/comments`
  const [items, setItems] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = () => api(url).then(setItems).catch(() => setItems([]))
  useEffect(() => { setItems(null); setDraft(''); setError(''); load() }, [url])   // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!draft.trim() || busy) return
    setBusy(true); setError('')
    try {
      await api(url, { method: 'POST', body: { text: draft } })
      setDraft('')
      await load()
    } catch { setError('Не удалось отправить комментарий') }
    setBusy(false)
  }
  async function remove(id) {
    try { await api(`${url}/${id}`, { method: 'DELETE' }); await load() } catch { setError('Не удалось удалить') }
  }

  return (
    <aside className="card-side" aria-label="Комментарии">
      <div className="card-side-head">Все комментарии</div>
      <div className="card-side-list">
        {items === null ? <div className="muted">Загрузка…</div>
          : items.length === 0
            ? readOnly ? <div className="card-side-empty"><Icon name="chat" size={28} /><strong>Комментариев нет</strong></div>
            : <div className="card-side-empty"><Icon name="chat" size={28} /><strong>Начните обсуждение</strong>
                <span>Задайте вопрос или оставьте заметку о записи — её увидят все, кому доступна таблица.</span></div>
            : <ul>{items.map(c => (
                <li key={c.id}>
                  <div className="muted"><strong>{c.user}</strong> · <span className="num">{when(c.at)}</span>
                    {c.mine && !readOnly && <button className="quiet" aria-label="Удалить комментарий" onClick={() => remove(c.id)}><Icon name="trash" size={12} /></button>}
                  </div>
                  <div className="card-side-text">{c.text}</div>
                </li>))}</ul>}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {!readOnly && <textarea className="card-side-input" aria-label="Комментарий" placeholder="Оставьте комментарий" rows={2} maxLength={10000}
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />}
    </aside>
  )
}
