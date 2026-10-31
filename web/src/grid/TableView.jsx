import { useState } from 'react'
import { useRecords } from '../record/useRecords.js'
import Grid from './Grid.jsx'
import Card from '../card/Card.jsx'

export default function TableView({ tableId, primaryField }) {
  const { fields, rows, loading, patch } = useRecords(tableId)
  const [open, setOpen] = useState(null)   // запись, открытая в карточке
  const [error, setError] = useState('')

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
      <Grid fields={fields} rows={rows} primaryField={primaryField} onEdit={onEdit} onOpen={setOpen} />
      {open && (
        <Card
          record={rows.find(r => r.id === open.id) ?? open}
          fields={fields}
          onSave={values => onEdit(open, Object.keys(values)[0], Object.values(values)[0])}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
