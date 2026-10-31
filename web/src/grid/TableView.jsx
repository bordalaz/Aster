import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useRecords } from '../record/useRecords.js'
import Grid from './Grid.jsx'
import Card from '../card/Card.jsx'
import ViewBar from '../views/ViewBar.jsx'

export default function TableView({ tableId, primaryField, user }) {
  const { fields, rows, loading, patch } = useRecords(tableId)
  const [open, setOpen] = useState(null)   // запись, открытая в карточке
  const [error, setError] = useState('')
  const [views, setViews] = useState([])
  const [current, setCurrent] = useState(null)   // id вида; null — «Все записи»
  const [config, setConfig] = useState({})

  // Перечитать виды и выбрать нужный (после сохранения/удаления).
  const reload = useCallback(async select => {
    const vs = await api(`/api/tables/${tableId}/views`).catch(() => [])
    setViews(vs)
    const v = vs.find(x => x.id === select)
    setCurrent(v ? v.id : null)
    setConfig(v ? v.config : {})
  }, [tableId])
  useEffect(() => { reload(null) }, [reload])

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

  if (loading) return <div style={{ padding: 16 }}>Загрузка…</div>

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <div className="err" style={{ padding: '6px 16px' }}>{error}</div>}
      <ViewBar tableId={tableId} fields={fields} primaryField={primaryField} user={user} views={views} current={current}
        config={config} setConfig={setConfig} onSelect={select} reload={reload} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Grid key={current ?? 'all'} fields={fields} rows={rows} primaryField={primaryField} config={config}
          onConfigChange={setConfig} onEdit={onEdit} onOpen={setOpen} />
      </div>
      {open && (
        <Card
          tableId={tableId}
          record={rows.find(r => r.id === open.id) ?? open}
          fields={fields}
          onSave={async values => {
            setError('')
            try { await patch(open, values) }
            catch (e) { setError(e.status === 409 ? 'Запись изменил другой пользователь — показана свежая версия' : 'Не удалось сохранить'); throw e }
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
