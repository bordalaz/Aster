import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { displayValue } from '../grid/cells.js'
import { Icon } from '../ui/icons.jsx'

const when = at => new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const rel = new Intl.RelativeTimeFormat('ru', { numeric: 'auto', style: 'short' })
// «4 дн. назад», как «4d ago» в Airtable; точное время — во всплывающей подсказке
function ago(at) {
  const s = (new Date(at) - Date.now()) / 1000
  for (const [u, n] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= n) return rel.format(Math.round(s / n), u)
  }
  return 'только что'
}

const FILTERS = [['all', 'Вся активность'], ['history', 'История изменений'], ['comments', 'Комментарии']]
const KEY = 'aster.feed'
const PAGE = 30

// Правая панель карточки, как в Airtable: комментарии и история изменений одной лентой (новое внизу),
// фильтр «Вся активность / История изменений / Комментарии» помнится в браузере. Без fields — только комментарии.
// readOnly — удалённая запись в корзине: лента видна, писать и удалять нельзя. version — перечитать историю.
export default function Comments({ tableId, recordId, readOnly = false, fields, version }) {
  const url = `/api/tables/${tableId}/records/${recordId}/comments`
  const withHistory = !!fields
  const [items, setItems] = useState(null)
  const [history, setHistory] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState(() => { try { return localStorage.getItem(KEY) || 'all' } catch { return 'all' } })
  const [menu, setMenu] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const list = useRef(null)
  const load = () => api(url).then(setItems).catch(() => setItems([]))
  useEffect(() => { setItems(null); setDraft(''); setError(''); setLimit(PAGE); load() }, [url])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!withHistory) return
    let live = true
    api(`/api/tables/${tableId}/records/${recordId}/history`).then(h => { if (live) setHistory(h) }, () => { if (live) setHistory([]) })
    return () => { live = false }
  }, [withHistory, tableId, recordId, version])

  const mode = withHistory ? filter : 'comments'
  const feed = [
    ...(mode !== 'history' ? (items ?? []).map(c => ({ kind: 'comment', at: c.at, c })) : []),
    ...(mode !== 'comments' ? (history ?? []).map((e, i, all) => ({ kind: 'change', at: e.at, e, first: i === all.length - 1 })) : []),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))
  const shown = feed.slice(-limit)
  const ready = items !== null && (!withHistory || history !== null)

  // новое — внизу, как в чате: при открытии и новых записях лента прокручена к концу
  const count = feed.length
  useLayoutEffect(() => { if (list.current && limit === PAGE) list.current.scrollTop = list.current.scrollHeight }, [count, ready, mode])   // eslint-disable-line react-hooks/exhaustive-deps

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
  const pick = v => { setFilter(v); setMenu(false); setLimit(PAGE); try { localStorage.setItem(KEY, v) } catch { /* приватный режим */ } }
  const title = FILTERS.find(f => f[0] === mode)[1]

  return (
    <aside className="card-side" aria-label={withHistory ? 'Активность' : 'Комментарии'}>
      <div className="card-side-head">
        {withHistory ? (
          <span style={{ position: 'relative' }}>
            <button type="button" className="quiet feed-filter" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              {title}<Icon name="caretDown" size={12} />
            </button>
            {menu && <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onMouseDown={() => setMenu(false)} />
              <div className="pop menu" role="menu" style={{ left: 0, top: 'calc(100% + 4px)', zIndex: 31, minWidth: 200 }}>
                {FILTERS.map(([v, label]) => (
                  <button key={v} role="menuitem" onClick={() => pick(v)}>
                    {label}{v === mode && <Icon name="check" size={14} style={{ marginLeft: 'auto' }} />}
                  </button>))}
              </div>
            </>}
          </span>
        ) : 'Все комментарии'}
      </div>
      <div className="card-side-list" ref={list}>
        {!ready ? <div className="muted">Загрузка…</div>
          : feed.length === 0
            ? mode === 'history' ? <div className="card-side-empty"><Icon name="snapshot" size={28} /><strong>Изменений не было</strong></div>
            : readOnly ? <div className="card-side-empty"><Icon name="chat" size={28} /><strong>Комментариев нет</strong></div>
            : <div className="card-side-empty"><Icon name="chat" size={28} /><strong>Начните обсуждение</strong>
                <span>Задайте вопрос или оставьте заметку о записи — её увидят все, кому доступна таблица.</span></div>
            : <>
                {feed.length > shown.length && <button type="button" className="btn feed-more" onClick={() => setLimit(l => l + PAGE)}>Показать ещё</button>}
                <ul>{shown.map((it, i) => (it.kind === 'comment'
                  ? <li key={'c' + it.c.id}>
                      <div className="muted"><strong>{it.c.user}</strong> · <span className="num" title={when(it.at)}>{ago(it.at)}</span>
                        {it.c.mine && !readOnly && <button className="quiet" aria-label="Удалить комментарий" onClick={() => remove(it.c.id)}><Icon name="trash" size={12} /></button>}
                      </div>
                      <div className="card-side-text">{it.c.text}</div>
                    </li>
                  : <li key={'h' + i + it.at}><Change e={it.e} first={it.first} fields={fields} /></li>))}</ul>
              </>}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {!readOnly && <textarea className="card-side-input" aria-label="Комментарий" placeholder="Оставьте комментарий" rows={2} maxLength={10000}
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />}
    </aside>
  )
}

// Одна правка, как в Airtable: кто и когда, поле капсом, убранное — зачёркнуто красным, новое — в зелёной рамке.
function Change({ e, first, fields }) {
  const head = <div className="muted"><strong>{e.user}</strong> · <span className="num" title={when(e.at)}>{ago(e.at)}</span></div>
  // id: null → N — создана (самая ранняя) или возвращена из корзины; N → null — в корзину
  if (e.column_name === 'id') {
    return <>{head}<div className="feed-box">{e.new == null ? 'Запись удалена в корзину' : first ? 'Запись создана' : 'Запись восстановлена из корзины'}</div></>
  }
  const f = fields.find(x => x.column_name === e.column_name)
  const show = v => (f ? displayValue(f, v) : v == null ? '' : String(v))
  let gone, came
  if (Array.isArray(e.old) || Array.isArray(e.new)) {   // связь, выбор нескольких: только что убрали и что добавили
    const key = x => (x && typeof x === 'object' ? x.id ?? JSON.stringify(x) : x)
    const o = e.old ?? [], n = e.new ?? []
    const ok = new Set(o.map(key)), nk = new Set(n.map(key))
    gone = o.filter(x => !nk.has(key(x))).map(x => show([x]))
    came = n.filter(x => !ok.has(key(x))).map(x => show([x]))
  } else {
    gone = e.old == null || e.old === '' ? [] : [show(e.old)]
    came = e.new == null || e.new === '' ? [] : [show(e.new)]
  }
  return <>
    {head}
    <div className="feed-box">
      <div className="feed-field">{e.field}</div>
      <div className="feed-vals">
        {!gone.length && !came.length && <span className="muted">Порядок изменён</span>}
        {gone.map((v, i) => <del key={'o' + i} className="feed-old">{v}</del>)}
        {came.map((v, i) => <ins key={'n' + i} className="feed-new">{v}</ins>)}
      </div>
    </div>
  </>
}
