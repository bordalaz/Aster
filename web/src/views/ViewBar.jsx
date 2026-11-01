import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api.js'
import { groupCols, LIST_OPS, NO_VALUE, OPS, sameConfig, visibleColumns } from '../grid/viewConfig.js'
import { Icon } from '../ui/icons.jsx'

const isAdmin = u => u?.role === 'superadmin' || u?.role === 'admin'
const errText = e => (e instanceof ApiError && typeof e.body?.detail === 'string') ? e.body.detail : 'Не удалось сохранить вид'

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many
}

// Закрыть всплывающее окно по щелчку мимо или Esc.
function useDismiss(open, close) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = e => { if (ref.current && !ref.current.contains(e.target)) close() }
    const key = e => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, close])
  return ref
}

// Список видов слева (☰), как в Airtable: «+ Создать вид», поиск, разделы «Мои личные» и «Общие» (сворачиваются).
// onCreate(title) — новый личный вид из текущих настроек.
export function ViewsSide({ views, current, onSelect, onCreate }) {
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState(new Set())
  const [naming, setNaming] = useState(null)   // null | строка названия
  const match = v => v.title.toLowerCase().includes(q.trim().toLowerCase())
  const item = v => (
    <button key={v.id ?? 'all'} className="vs-item" aria-current={current === v.id ? 'true' : undefined} onClick={() => onSelect(v.id)} title={v.title}>
      <Icon name="table" size={16} style={{ color: 'var(--accent)' }} /><span>{v.title}</span>
    </button>
  )
  const section = (key, title, list) => list.length > 0 && (
    <div key={key}>
      <button className="vs-section" aria-expanded={!closed.has(key)}
        onClick={() => setClosed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })}>
        <Icon name="caretDown" size={12} style={closed.has(key) ? { transform: 'rotate(-90deg)' } : undefined} />{title}
      </button>
      {!closed.has(key) && <div className="vs-list">{list.map(item)}</div>}
    </div>
  )
  return (
    <aside className="views-side" aria-label="Виды">
      {onCreate && (naming === null
        ? <button className="vs-create" onClick={() => setNaming('')}><Icon name="plus" size={14} />Создать вид</button>
        : <form className="vs-create-form" onSubmit={e => { e.preventDefault(); if (naming.trim()) { onCreate(naming.trim()); setNaming(null) } }}>
            <input autoFocus aria-label="Название нового вида" placeholder="Название вида" value={naming} maxLength={200}
              onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setNaming(null) }} />
          </form>)}
      <label className="vs-search"><Icon name="search" size={14} />
        <input aria-label="Найти вид" placeholder="Найти вид" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="vs-list">{match({ title: 'Все записи' }) && item({ id: null, title: 'Все записи' })}</div>
      {section('mine', 'Мои личные виды', views.filter(v => !v.shared && match(v)))}
      {section('shared', 'Общие виды', views.filter(v => v.shared && match(v)))}
    </aside>
  )
}

// Панель вида (R10): меню вида, скрытые поля, фильтр, группировка, сортировка, поиск.
export default function ViewBar({ tableId, fields, primaryField, user, views, current, config, setConfig, reload,
  side, onToggleSide, search, onSearch, onExport }) {
  const [panel, setPanel] = useState(null)   // 'menu' | 'columns' | 'filters' | 'group' | 'sort' | 'saveas' | 'search'
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [shared, setShared] = useState(false)
  const close = () => setPanel(null)
  const ref = useDismiss(panel !== null, close)
  const toggle = p => setPanel(panel === p ? null : p)

  const view = views.find(v => v.id === current)
  const canEdit = view && (view.mine || (view.shared && isAdmin(user)))
  const dirty = !sameConfig(config, view?.config ?? {})
  const filters = config.filters ?? []
  const sorts = config.sort ?? []
  const titleOf = c => fields.find(f => f.column_name === c)?.title ?? c

  async function run(fn) {
    setError('')
    try { await fn() } catch (e) { setError(errText(e)) }
  }
  const save = () => run(async () => {
    await api(`/api/views/${view.id}`, { method: 'PATCH', body: { config } })
    await reload(view.id)
    close()
  })
  const saveAs = e => {
    e.preventDefault()
    run(async () => {
      const { source, ...own } = config   // копия — уже свой вид, не «из Airtable»
      const { id } = await api(`/api/tables/${tableId}/views`, { method: 'POST', body: { title, shared, config: own } })
      close(); setTitle(''); setShared(false)
      await reload(id)
    })
  }
  const remove = () => run(async () => {
    await api(`/api/views/${view.id}`, { method: 'DELETE' })
    close()
    await reload(null)
  })

  // Колонки: видимые по порядку, затем скрытые.
  const shown = visibleColumns(fields, primaryField, config.columns).map(c => c.column_name).filter(c => c !== primaryField)
  const hidden = fields.map(f => f.column_name).filter(c => c !== primaryField && !shown.includes(c))
  const setColumns = columns => setConfig({ ...config, columns })
  const move = (i, d) => {
    const next = [...shown]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    setColumns(next)
  }
  const setFilter = (i, p) => setConfig({ ...config, filters: filters.map((f, j) => (j === i ? { ...f, ...p } : f)) })
  // смена условия между списочным и обычным — значение переводится, а не теряется
  const setOp = (i, op) => {
    const v = filters[i].value
    const value = LIST_OPS.has(op) ? (Array.isArray(v) ? v : v ? [String(v)] : []) : (Array.isArray(v) ? v.join(';') : v)
    setFilter(i, { op, value })
  }
  const groups = groupCols(config.group)
  const setGroup = (level, col) => {
    const next = [...groups.slice(0, level), ...(col ? [col] : [])]
    const { group, ...rest } = config
    setConfig(next.length ? { ...rest, group: next } : rest)
  }
  const setSorts = next => {
    const { sort, ...rest } = config
    setConfig(next.length ? { ...rest, sort: next } : rest)
  }

  const fieldOptions = fields.map(f => <option key={f.column_name} value={f.column_name}>{f.title}</option>)
  const label = {
    columns: hidden.length ? `${hidden.length} ${plural(hidden.length, 'скрытое поле', 'скрытых поля', 'скрытых полей')}` : 'Скрыть поля',
    filters: filters.length === 1 ? `Отфильтровано: ${titleOf(filters[0].col)}`
      : filters.length ? `Отфильтровано: ${filters.length} ${plural(filters.length, 'условие', 'условия', 'условий')}` : 'Фильтр',
    group: groups.length ? `Группировка: ${groups.length} ${plural(groups.length, 'поле', 'поля', 'полей')}` : 'Группировка',
    sort: sorts.length ? `Сортировка: ${sorts.length} ${plural(sorts.length, 'поле', 'поля', 'полей')}` : 'Сортировка',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="viewbar">
        <button className="tool" aria-label="Список видов" aria-pressed={side} onClick={onToggleSide}><Icon name="list" /></button>
        <div style={{ position: 'relative' }}>
          <button className="tool" aria-haspopup="menu" aria-label={`Вид: ${view?.title ?? 'Все записи'}`} aria-expanded={panel === 'menu'} onClick={() => toggle('menu')}>
            <Icon name="table" style={{ color: 'var(--accent)' }} />
            <span className="viewname">{view?.title ?? 'Все записи'}</span>
            <Icon name="caretDown" size={12} />
          </button>
          {panel === 'menu' && (
            <div className="pop menu" role="menu" style={{ left: 0, top: 32 }}>
              {canEdit && dirty && <button role="menuitem" onClick={save}><Icon name="floppy" />Сохранить вид</button>}
              <button role="menuitem" onClick={() => setPanel('saveas')}><Icon name="copy" />Сохранить как…</button>
              <button role="menuitem" onClick={() => { onExport?.(); close() }}><Icon name="download" />Выгрузить CSV</button>
              {canEdit && <><div className="sep" /><button role="menuitem" onClick={remove} style={{ color: 'var(--danger)' }}><Icon name="trash" />Удалить вид</button></>}
            </div>
          )}
          {panel === 'saveas' && (
            <form className="pop" onSubmit={saveAs} style={{ left: 0, top: 32 }}>
              <h4>Новый вид</h4>
              <input aria-label="Название вида" placeholder="Название вида" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} autoFocus />
              {isAdmin(user) && <label className="row"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />общий</label>}
              <div className="row"><button className="btn primary" type="submit" disabled={!title.trim()}>Сохранить</button></div>
            </form>
          )}
        </div>
        {dirty && <span className="dirty">не сохранено</span>}
        {canEdit && dirty && <button className="tool" onClick={save}>Сохранить</button>}

        <div className="spacer" />

        <div style={{ position: 'relative' }}>
          <button className={`tool hidden${hidden.length ? ' on' : ''}`} aria-expanded={panel === 'columns'} onClick={() => toggle('columns')}>
            <Icon name="eyeSlash" />{label.columns}
          </button>
          {panel === 'columns' && (
            <div className="pop" aria-label="Поля" role="group" style={{ right: 0, top: 32 }}>
              {shown.map((c, i) => (
                <div key={c} className="row">
                  <label className="row" style={{ flex: 1 }}><input type="checkbox" checked onChange={() => setColumns(shown.filter(x => x !== c))} />{titleOf(c)}</label>
                  <button className="quiet" aria-label={`Выше: ${titleOf(c)}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="quiet" aria-label={`Ниже: ${titleOf(c)}`} disabled={i === shown.length - 1} onClick={() => move(i, 1)}>↓</button>
                </div>
              ))}
              {hidden.map(c => (
                <label key={c} className="row" style={{ color: 'var(--muted)' }}>
                  <input type="checkbox" checked={false} onChange={() => setColumns([...shown, c])} />{titleOf(c)}
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button className={`tool filter${filters.length ? ' on' : ''}`} aria-expanded={panel === 'filters'} onClick={() => toggle('filters')}>
            <Icon name="funnel" />{label.filters}
          </button>
          {panel === 'filters' && (
            <div className="pop" aria-label="Фильтр" role="group" style={{ right: 0, top: 32 }}>
              <h4>{filters.length ? 'Записи, где' : 'Условий фильтра пока нет'}</h4>
              {filters.map((f, i) => (
                <div key={i} className="row">
                  <select aria-label="Поле фильтра" value={f.col} onChange={e => setFilter(i, { col: e.target.value })}>{fieldOptions}</select>
                  <select aria-label="Условие" value={f.op} onChange={e => setOp(i, e.target.value)}>
                    {Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {!NO_VALUE.has(f.op) && (LIST_OPS.has(f.op)
                    ? <input aria-label="Значение фильтра" title="Несколько значений — через ;" placeholder="значение; значение"
                        value={(f.value ?? []).join(';')} onChange={e => setFilter(i, { value: e.target.value.split(';').slice(0, 50) })} />
                    : <input aria-label="Значение фильтра" value={f.value ?? ''} maxLength={500} onChange={e => setFilter(i, { value: e.target.value })} />)}
                  <button className="quiet" aria-label="Убрать условие"
                    onClick={() => setConfig({ ...config, filters: filters.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                </div>
              ))}
              <button className="link" disabled={filters.length >= 30}
                onClick={() => setConfig({ ...config, filters: [...filters, { col: primaryField ?? fields[0]?.column_name, op: 'contains', value: '' }] })}>
                + условие
              </button>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button className={`tool group${groups.length ? ' on' : ''}`} aria-expanded={panel === 'group'} onClick={() => toggle('group')}>
            <Icon name="rows" />{label.group}
          </button>
          {panel === 'group' && (
            <div className="pop" aria-label="Группировка записей" role="group" style={{ right: 0, top: 32 }}>
              <h4>Группировать по</h4>
              {[0, 1, 2].filter(l => l <= groups.length).map(l => (
                <select key={l} aria-label={l ? `Группировка, уровень ${l + 1}` : 'Группировка'} value={groups[l] ?? ''}
                  onChange={e => setGroup(l, e.target.value)}>
                  <option value="">{l ? '+ ещё уровень' : 'Без группировки'}</option>
                  {fieldOptions}
                </select>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button className={`tool sort${sorts.length ? ' on' : ''}`} aria-expanded={panel === 'sort'} onClick={() => toggle('sort')}>
            <Icon name="sort" />{label.sort}
          </button>
          {panel === 'sort' && (
            <div className="pop" aria-label="Сортировка" role="group" style={{ right: 0, top: 32 }}>
              <h4>Сортировать по</h4>
              {sorts.map((s, i) => (
                <div key={i} className="row">
                  <select aria-label="Поле сортировки" value={s.col}
                    onChange={e => setSorts(sorts.map((x, j) => (j === i ? { ...x, col: e.target.value } : x)))}>{fieldOptions}</select>
                  <select aria-label="Направление" value={s.desc ? 'desc' : 'asc'}
                    onChange={e => setSorts(sorts.map((x, j) => (j === i ? { ...x, desc: e.target.value === 'desc' } : x)))}>
                    <option value="asc">А → Я, 1 → 9</option>
                    <option value="desc">Я → А, 9 → 1</option>
                  </select>
                  <button className="quiet" aria-label="Убрать сортировку" onClick={() => setSorts(sorts.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
                </div>
              ))}
              <button className="link" onClick={() => setSorts([...sorts, { col: primaryField ?? fields[0]?.column_name, desc: false }])}>+ сортировка</button>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          {panel === 'search' || search
            ? <input className="tool" style={{ border: '1px solid var(--line)', width: 200, cursor: 'text' }} placeholder="Поиск" aria-label="Поиск"
                autoFocus value={search} onChange={e => onSearch(e.target.value)} />
            : <button className="tool" aria-label="Поиск" onClick={() => setPanel('search')}><Icon name="search" /></button>}
        </div>
      </div>
      {error && <div className="err" role="alert" style={{ padding: '4px 12px' }}>{error}</div>}
    </div>
  )
}
