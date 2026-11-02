import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useRecords } from '../record/useRecords.js'
import Grid from './Grid.jsx'
import Card from '../card/Card.jsx'
import ViewBar, { ViewsSide } from '../views/ViewBar.jsx'
import { groupCols, visibleColumns } from './viewConfig.js'
import { moveRows, orderRows } from './layout.js'
import SendDialog from './SendDialog.jsx'

export default function TableView({ tableId, primaryField, user, title, openId, onOpened, onOpenLink }) {
  const { fields, rows, loading, patch, patchMany, refresh } = useRecords(tableId)
  const [open, setOpen] = useState(null)   // запись, открытая в карточке
  const [order, setOrder] = useState([])   // id строк сетки по порядку — для ▲▼ в карточке
  const openRow = useCallback((row, ids) => { setOpen(row); if (ids) setOrder(ids) }, [])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(null)   // {rows, columns} — окно «Отправить запись»
  const [asking, setAsking] = useState(null)     // строки — «Удалить N записей?»
  const [undo, setUndo] = useState(null)         // {trash: [...], n} — «Запись удалена · Отменить» на 10 с
  const [views, setViews] = useState([])
  const [current, setCurrent] = useState(null)   // id вида; null — «Все записи»
  const [config, setConfig] = useState({})
  const [side, setSide] = useState(false)      // список видов слева (☰), по умолчанию свёрнут, как у владельца в Airtable
  const [search, setSearch] = useState('')
  const exportRef = useRef(null)

  // Последний вид таблицы и его несохранённые настройки — у пользователя в браузере (как Airtable помнит вид).
  // ponytail: localStorage, на одном устройстве; на сервер — если понадобится между устройствами
  const KEY = `aster.view.${user?.id ?? 0}.${tableId}`
  const ready = useRef(false)

  // Перечитать виды и выбрать нужный (после сохранения/удаления); cfg — восстановить несохранённое.
  const reload = useCallback(async (select, cfg) => {
    const vs = await api(`/api/tables/${tableId}/views`).catch(() => [])
    setViews(vs)
    const v = vs.find(x => x.id === select)
    setCurrent(v ? v.id : null)
    setConfig(cfg ?? (v ? v.config : {}))
  }, [tableId])
  useEffect(() => {
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(KEY)) } catch { /* нет хранилища — начнём с «Все записи» */ }
    reload(saved?.view ?? null, saved?.config).then(() => { ready.current = true })
  }, [reload, KEY])
  useEffect(() => {
    if (!ready.current) return
    try { localStorage.setItem(KEY, JSON.stringify({ view: current, config })) } catch { /* приватный режим */ }
  }, [KEY, current, config])

  // Пришли по связи из другой таблицы — открыть карточку нужной записи, когда строки загрузятся.
  useEffect(() => {
    if (openId == null || loading) return
    const r = rows.find(x => x.id === openId)
    if (r) setOpen(r)
    onOpened?.()
  }, [openId, loading, rows, onOpened])

  const select = id => {
    setCurrent(id)
    setConfig(views.find(v => v.id === id)?.config ?? {})
  }

  async function onEdit(row, column, value) {
    setError('')
    try {
      await patch(row, { [column]: value })
    } catch (e) {
      setError(e.status === 409 ? 'Запись изменил другой пользователь — показана свежая версия' : 'Не удалось сохранить')
    }
  }

  async function onEditMany(edits) {
    setError('')
    try {
      await patchMany(edits)
    } catch (e) {
      setError(e.status === 409 ? 'Часть записей изменил другой пользователь — вставка отменена, показаны свежие данные'
        : e.body?.detail && typeof e.body.detail === 'string' ? `Вставка не выполнена: ${e.body.detail}` : 'Вставка не выполнена')
    }
  }

  // «+» как в Airtable: пустая запись, сразу открыть её карточку (в фильтр вида она может не попасть)
  async function addRecord() {
    setError('')
    try {
      const { id, updated_at } = await api(`/api/tables/${tableId}/records`, { method: 'POST' })
      setOpen({ id, updated_at })   // карточку — сразу; формулы досчитаются, пока сетка перечитывается
      await refresh()
    } catch { setError('Не удалось добавить запись') }
  }

  // Ручной порядок: двигать строки может тот, кто меняет вид (общий — администратор, личный — владелец).
  const view = views.find(v => v.id === current)
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin'
  const canReorder = !!view && (view.mine || (view.shared && isAdmin))
  async function saveOrder(order) {
    setError('')
    try {
      await api(`/api/views/${current}/row-order`, { method: 'PUT', body: { order } })
      setViews(vs => vs.map(v => (v.id === current ? { ...v, config: { ...v.config, rowOrder: order } } : v)))   // вид не «изменён»
    } catch { setError('Не удалось сохранить порядок записей') }
  }

  // Вставить выше/ниже (как в Airtable): новая запись встаёт рядом и в ту же группу — значения полей группировки копируются.
  async function insertNear(row, where) {
    setError('')
    try {
      const { id, updated_at } = await api(`/api/tables/${tableId}/records`, { method: 'POST' })
      const group = Object.fromEntries(groupCols(config.group).filter(c => fields.find(f => f.column_name === c)?.editable).map(c => [c, row[c] ?? null]))
      if (Object.keys(group).length) await patch({ id, updated_at }, group).catch(() => {})
      if (where && canReorder) {
        const all = [...orderRows(rows, config.rowOrder).map(r => r.id), id]
        const order = moveRows(all, [id], row.id, where === 'below')
        setConfig(c => ({ ...c, rowOrder: order }))
        await saveOrder(order)
      }
      await refresh()
    } catch { setError('Не удалось вставить запись') }
  }

  // Дублировать (как в Airtable): копия правимых полей встаёт сразу под исходной. Связи и вложения не копируются.
  async function duplicate(row) {
    setError('')
    try {
      const { id, updated_at } = await api(`/api/tables/${tableId}/records`, { method: 'POST' })
      const values = Object.fromEntries(fields.filter(f => f.editable && !['multipleRecordLinks', 'multipleAttachments'].includes(f.kind)
        && row[f.column_name] != null).map(f => [f.column_name, row[f.column_name]]))
      if (Object.keys(values).length) await api(`/api/tables/${tableId}/records/${id}`, { method: 'PATCH', body: { updated_at, values } })
      if (canReorder) {
        const order = moveRows([...orderRows(rows, config.rowOrder).map(r => r.id), id], [id], row.id, true)
        setConfig(c => ({ ...c, rowOrder: order }))
        await saveOrder(order)
      }
      await refresh()
    } catch { setError('Не удалось дублировать запись') }
  }

  // Удаление — в корзину (решения владельца): одна запись — сразу, несколько — после вопроса; 10 с «Отменить».
  async function remove(rs) {
    setError(''); setAsking(null)
    try {
      const { trash } = await api(`/api/tables/${tableId}/records/delete`, { method: 'POST', body: { ids: rs.map(r => r.id) } })
      if (open && rs.some(r => r.id === open.id)) setOpen(null)
      setUndo({ trash, n: rs.length })
      await refresh()
    } catch { setError(rs.length > 1 ? 'Не удалось удалить записи' : 'Не удалось удалить запись') }
  }
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 10000)
    return () => clearTimeout(t)
  }, [undo])
  async function restore() {
    const u = undo
    setUndo(null)
    try { await api('/api/trash/restore', { method: 'POST', body: { ids: u.trash } }); await refresh() }
    catch { setError('Не удалось вернуть — запись в корзине, её можно восстановить оттуда') }
  }

  if (loading) return <div style={{ padding: 16 }}>Загрузка…</div>

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <div className="err" style={{ padding: '6px 16px' }}>{error}</div>}
      <ViewBar tableId={tableId} fields={fields} primaryField={primaryField} user={user} views={views} current={current}
        config={config} setConfig={setConfig} reload={reload} side={side} onToggleSide={() => setSide(!side)}
        search={search} onSearch={setSearch} onExport={() => exportRef.current?.()} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {side && <ViewsSide views={views} current={current} onSelect={select} onCreate={async t => {
          setError('')
          try {
            const { source, ...own } = config
            const { id } = await api(`/api/tables/${tableId}/views`, { method: 'POST', body: { title: t, shared: false, config: own } })
            await reload(id)
          } catch { setError('Не удалось создать вид') }
        }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Grid key={current ?? 'all'} fields={fields} rows={rows} primaryField={primaryField} title={title} config={config}
            onConfigChange={setConfig} onEdit={onEdit} onEditMany={onEditMany} onOpen={openRow} search={search} exportRef={exportRef}
            onAdd={fields.some(f => f.editable) ? addRecord : undefined}
            canReorder={canReorder} onReorder={saveOrder}
            onInsert={fields.some(f => f.editable) ? insertNear : undefined}
            onDuplicate={fields.some(f => f.editable) ? duplicate : undefined}
            onSend={(rs, columns) => setSending({ rows: rs, columns })}
            onDelete={fields.some(f => f.editable) ? rs => (rs.length > 1 ? setAsking(rs) : remove(rs)) : undefined}
            collapseKey={`aster.collapsed.${user?.id ?? 0}.${tableId}.${current ?? 'all'}`} />
        </div>
      </div>
      {asking && (
        <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setAsking(null) }}>
          <div className="confirm" role="alertdialog" aria-modal="true" aria-label="Удалить записи">
            <h2>Удалить {asking.length} {asking.length % 10 === 1 && asking.length % 100 !== 11 ? 'запись' : [2, 3, 4].includes(asking.length % 10) && ![12, 13, 14].includes(asking.length % 100) ? 'записи' : 'записей'}?</h2>
            <p>Записи уйдут в корзину — их можно будет восстановить в течение года.</p>
            <div className="send-foot">
              <button type="button" className="btn" autoFocus onClick={() => setAsking(null)}>Отмена</button>
              <button type="button" className="btn danger-fill" onClick={() => remove(asking)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
      {undo && (
        <div className="toast" role="status">
          <span>{undo.n === 1 ? 'Запись удалена' : `Удалено записей: ${undo.n}`}</span>
          <button type="button" onClick={restore}>Отменить</button>
        </div>
      )}
      {sending && <SendDialog tableId={tableId} table={title} rows={sending.rows} columns={sending.columns} fields={fields}
        user={user} onClose={() => setSending(null)} />}
      {open && (() => {
        const record = rows.find(r => r.id === open.id) ?? open
        const i = order.indexOf(open.id)
        const go = d => { const r = rows.find(x => x.id === order[i + d]); if (r) setOpen(r) }
        return (
          <Card
            tableId={tableId}
            record={record}
            fields={fields}
            shown={visibleColumns(fields, primaryField, config.columns).map(c => c.column_name)}
            primaryField={primaryField}
            onSave={async values => {
              setError('')
              // свежая версия записи: после каждой правки updated_at меняется
              try { await patch(rows.find(r => r.id === open.id) ?? open, values) }
              catch (e) { setError(e.status === 409 ? 'Запись изменил другой пользователь — показана свежая версия' : 'Не удалось сохранить'); throw e }
            }}
            onPrev={i > 0 ? () => go(-1) : undefined}
            onNext={i >= 0 && i < order.length - 1 ? () => go(1) : undefined}
            onClose={() => setOpen(null)}
            onOpenLink={onOpenLink}
            onChanged={refresh}
          />
        )
      })()}
    </div>
  )
}
