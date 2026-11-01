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

  // Перечитать виды и выбрать нужный (после сохранения/удаления).
  const reload = useCallback(async select => {
    const vs = await api(`/api/tables/${tableId}/views`).catch(() => [])
    setViews(vs)
    const v = vs.find(x => x.id === select)
    setCurrent(v ? v.id : null)
    setConfig(v ? v.config : {})
  }, [tableId])
  useEffect(() => { reload(null) }, [reload])

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

  if (loading) return <div style={{ padding: 16 }}>Загрузка…</div>

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <div className="err" style={{ padding: '6px 16px' }}>{error}</div>}
      <ViewBar tableId={tableId} fields={fields} primaryField={primaryField} user={user} views={views} current={current}
        config={config} setConfig={setConfig} reload={reload} side={side} onToggleSide={() => setSide(!side)}
        search={search} onSearch={setSearch} onExport={() => exportRef.current?.()} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {side && <ViewsSide views={views} current={current} onSelect={select} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Grid key={current ?? 'all'} fields={fields} rows={rows} primaryField={primaryField} title={title} config={config}
            onConfigChange={setConfig} onEdit={onEdit} onEditMany={onEditMany} onOpen={openRow} search={search} exportRef={exportRef} />
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
