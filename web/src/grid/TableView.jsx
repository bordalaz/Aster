import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useRecords } from '../record/useRecords.js'
import Grid from './Grid.jsx'
import Card from '../card/Card.jsx'
import ViewBar, { ViewsSide } from '../views/ViewBar.jsx'
import { visibleColumns } from './viewConfig.js'

export default function TableView({ tableId, primaryField, user, title, openId, onOpened, onOpenLink }) {
  const { fields, rows, loading, patch, patchMany, refresh } = useRecords(tableId)
  const [open, setOpen] = useState(null)   // запись, открытая в карточке
  const [order, setOrder] = useState([])   // id строк сетки по порядку — для ▲▼ в карточке
  const openRow = useCallback((row, ids) => { setOpen(row); if (ids) setOrder(ids) }, [])
  const [error, setError] = useState('')
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
            onAdd={fields.some(f => f.editable) ? addRecord : undefined} />
        </div>
      </div>
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
