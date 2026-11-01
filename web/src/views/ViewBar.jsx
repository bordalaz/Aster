import { useState } from 'react'
import { api, ApiError } from '../api.js'
import { groupCols, LIST_OPS, NO_VALUE, OPS, sameConfig, visibleColumns } from '../grid/viewConfig.js'

const isAdmin = u => u?.role === 'superadmin' || u?.role === 'admin'
const errText = e => (e instanceof ApiError && typeof e.body?.detail === 'string') ? e.body.detail : 'Не удалось сохранить вид'

// Выбор и сохранение видов (R10) + панели «Колонки» и «Фильтры». Конфиг сетки живёт в TableView.
export default function ViewBar({ tableId, fields, primaryField, user, views, current, config, setConfig, onSelect, reload }) {
  const [panel, setPanel] = useState(null)   // 'columns' | 'filters' | 'saveas' | null
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [shared, setShared] = useState(false)

  const view = views.find(v => v.id === current)
  const canEdit = view && (view.mine || (view.shared && isAdmin(user)))
  const dirty = !sameConfig(config, view?.config ?? {})
  const filters = config.filters ?? []

  async function run(fn) {
    setError('')
    try { await fn() } catch (e) { setError(errText(e)) }
  }
  const save = () => run(async () => {
    await api(`/api/views/${view.id}`, { method: 'PATCH', body: { config } })
    await reload(view.id)
  })
  const saveAs = e => {
    e.preventDefault()
    run(async () => {
      const { source, ...own } = config   // копия — уже свой вид, не «из Airtable»
      const { id } = await api(`/api/tables/${tableId}/views`, { method: 'POST', body: { title, shared, config: own } })
      setPanel(null); setTitle(''); setShared(false)
      await reload(id)
    })
  }
  const remove = () => run(async () => {
    await api(`/api/views/${view.id}`, { method: 'DELETE' })
    await reload(null)
  })

  // Колонки: видимые по порядку, затем скрытые.
  const shown = visibleColumns(fields, primaryField, config.columns).map(c => c.column_name).filter(c => c !== primaryField)
  const hidden = fields.map(f => f.column_name).filter(c => c !== primaryField && !shown.includes(c))
  const titleOf = c => fields.find(f => f.column_name === c)?.title ?? c
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

  const bar = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }
  const box = { padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gap: 6, maxHeight: 280, overflowY: 'auto' }

  return (
    <div>
      <div style={bar}>
        <select aria-label="Вид" value={current ?? ''} onChange={e => onSelect(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Все записи</option>
          {views.some(v => v.shared) && <optgroup label="Общие">
            {views.filter(v => v.shared).map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </optgroup>}
          {views.some(v => !v.shared) && <optgroup label="Мои">
            {views.filter(v => !v.shared).map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </optgroup>}
        </select>
        {dirty && <span style={{ color: 'var(--warn, #F08A24)', fontSize: 12 }}>не сохранено</span>}
        {[0, 1, 2].filter(l => l <= groups.length).map(l => (
          <select key={l} aria-label={l ? `Группировка, уровень ${l + 1}` : 'Группировка'} value={groups[l] ?? ''}
            onChange={e => setGroup(l, e.target.value)}>
            <option value="">{l ? 'затем —' : 'Без группировки'}</option>
            {fields.map(f => <option key={f.column_name} value={f.column_name}>{l ? 'затем: ' : 'Группа: '}{f.title}</option>)}
          </select>
        ))}
        <button className="btn" aria-pressed={panel === 'columns'} onClick={() => setPanel(panel === 'columns' ? null : 'columns')}>Колонки</button>
        <button className="btn" aria-pressed={panel === 'filters'} onClick={() => setPanel(panel === 'filters' ? null : 'filters')}>
          Фильтры{filters.length ? ` (${filters.length})` : ''}
        </button>
        {canEdit && dirty && <button className="btn primary" onClick={save}>Сохранить вид</button>}
        <button className="btn" onClick={() => setPanel(panel === 'saveas' ? null : 'saveas')}>Сохранить как…</button>
        {canEdit && <button className="btn" onClick={remove}>Удалить вид</button>}
      </div>

      {error && <div className="err" role="alert" style={{ padding: '4px 12px' }}>{error}</div>}

      {panel === 'columns' && (
        <div style={box} aria-label="Колонки" role="group">
          {shown.map((c, i) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ flex: 1 }}><input type="checkbox" checked onChange={() => setColumns(shown.filter(x => x !== c))} /> {titleOf(c)}</label>
              <button className="btn" aria-label={`Выше: ${titleOf(c)}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn" aria-label={`Ниже: ${titleOf(c)}`} disabled={i === shown.length - 1} onClick={() => move(i, 1)}>↓</button>
            </div>
          ))}
          {hidden.map(c => (
            <label key={c} style={{ color: 'var(--muted)' }}>
              <input type="checkbox" checked={false} onChange={() => setColumns([...shown, c])} /> {titleOf(c)}
            </label>
          ))}
        </div>
      )}

      {panel === 'filters' && (
        <div style={box} aria-label="Фильтры" role="group">
          {filters.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select aria-label="Поле фильтра" value={f.col} onChange={e => setFilter(i, { col: e.target.value })}>
                {fields.map(x => <option key={x.column_name} value={x.column_name}>{x.title}</option>)}
              </select>
              <select aria-label="Условие" value={f.op} onChange={e => setOp(i, e.target.value)}>
                {Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {!NO_VALUE.has(f.op) && (LIST_OPS.has(f.op)
                ? <input aria-label="Значение фильтра" title="Несколько значений — через ;" placeholder="значение; значение"
                    value={(f.value ?? []).join(';')} onChange={e => setFilter(i, { value: e.target.value.split(';').slice(0, 50) })} />
                : <input aria-label="Значение фильтра" value={f.value ?? ''} maxLength={500} onChange={e => setFilter(i, { value: e.target.value })} />)}
              <button className="btn" aria-label="Убрать условие"
                onClick={() => setConfig({ ...config, filters: filters.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <div>
            <button className="btn" disabled={filters.length >= 30}
              onClick={() => setConfig({ ...config, filters: [...filters, { col: primaryField ?? fields[0]?.column_name, op: 'contains', value: '' }] })}>
              + условие
            </button>
          </div>
        </div>
      )}

      {panel === 'saveas' && (
        <form onSubmit={saveAs} style={{ ...box, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Название вида" placeholder="Название вида" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} autoFocus />
          {isAdmin(user) && <label><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> общий</label>}
          <button className="btn primary" type="submit" disabled={!title.trim()}>Сохранить</button>
        </form>
      )}
    </div>
  )
}
