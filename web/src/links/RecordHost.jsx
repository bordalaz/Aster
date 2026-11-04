import { useCallback, useEffect, useState } from 'react'
import Card from '../card/Card.jsx'
import { api } from '../api.js'
import { SERVED, wire } from '../record/useRecords.js'
import { forgetNames } from './data.js'

// Карточка записи другой таблицы поверх текущего экрана — новая запись из выбора связи (как в Airtable).
// После закрытия: названия таблицы и открытые таблицы перечитываются (у связи появится название новой записи).
export default function RecordHost() {
  const [open, setOpen] = useState(null)   // {tableId, id}
  useEffect(() => {
    const on = e => setOpen(e.detail)
    window.addEventListener('aster:open-record', on)
    return () => window.removeEventListener('aster:open-record', on)
  }, [])
  const close = useCallback(() => {
    forgetNames(open?.tableId)
    setOpen(null)
    window.dispatchEvent(new Event('aster:records-changed'))
  }, [open])
  return open ? <OtherCard key={`${open.tableId}:${open.id}`} {...open} onClose={close} /> : null
}

function OtherCard({ tableId, id, onClose }) {
  const [data, setData] = useState(null)   // {fields, record, primary}
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const [tables, fields, rows] = await Promise.all([api('/api/tables'), api(`/api/tables/${tableId}/fields`),
      api(`/api/tables/${tableId}/records?ids=${id}&fresh=1`)])
    if (!rows[0]) throw new Error('нет записи')
    setData({ fields: fields.filter(f => !f.options?.virtual || SERVED.has(f.kind)), record: rows[0],
      primary: tables.find(t => t.id === tableId)?.primary_field })
  }, [tableId, id])
  useEffect(() => { load().catch(() => setError('Не удалось открыть запись')) }, [load])
  if (error) return <div className="card-backdrop" onMouseDown={onClose}><div className="card err" role="alert">{error}</div></div>
  if (!data) return null
  return (
    <Card tableId={tableId} record={data.record} fields={data.fields} primaryField={data.primary} onClose={onClose} onChanged={load}
      onSave={async values => {
        await api(`/api/tables/${tableId}/records/${id}`, { method: 'PATCH', body: { updated_at: data.record.updated_at, values: wire(values) } })
        await load()
      }} />
  )
}
