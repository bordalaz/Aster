import { useCallback, useEffect, useState } from 'react'
import Card from '../card/Card.jsx'
import { api } from '../api.js'
import { SERVED, wire } from '../record/useRecords.js'
import { forgetNames, openRecord } from './data.js'

// Карточки записей других таблиц поверх текущего экрана, стопкой, как в Airtable: щелчок по связанной записи
// в карточке, новая запись из выбора связи. Esc и ✕ закрывают только верхнюю; таблица под ними не меняется.
// После закрытия: названия таблицы и открытые таблицы перечитываются (у связи появится название новой записи).
export default function RecordHost() {
  const [stack, setStack] = useState([])   // [{tableId, id, key}]
  useEffect(() => {
    let n = 0
    const on = e => setStack(s => [...s, { ...e.detail, key: ++n }])
    window.addEventListener('aster:open-record', on)
    return () => window.removeEventListener('aster:open-record', on)
  }, [])
  const close = useCallback(top => {
    forgetNames(top.tableId)
    setStack(s => s.filter(x => x !== top))
    window.dispatchEvent(new Event('aster:records-changed'))
  }, [])
  return stack.map((x, i) => <OtherCard key={x.key} tableId={x.tableId} id={x.id} depth={i + 1} onClose={() => close(x)} />)
}

function OtherCard({ tableId, id, depth, onClose }) {
  const [data, setData] = useState(null)   // {fields, record, primary, title}
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const [tables, fields, rows] = await Promise.all([api('/api/tables'), api(`/api/tables/${tableId}/fields`),
      api(`/api/tables/${tableId}/records?ids=${id}&fresh=1`)])
    if (!rows[0]) throw new Error('нет записи')
    const t = tables.find(x => x.id === tableId)
    setData({ fields: fields.filter(f => !f.options?.virtual || SERVED.has(f.kind)), record: rows[0],
      primary: t?.primary_field, title: t?.title })
  }, [tableId, id])
  useEffect(() => { load().catch(() => setError('Не удалось открыть запись')) }, [load])
  if (error) return <div className="card-backdrop" onMouseDown={onClose}><div className="card err" role="alert">{error}</div></div>
  if (!data) return null
  return (
    <Card tableId={tableId} record={data.record} fields={data.fields} primaryField={data.primary} onClose={onClose} onChanged={load}
      depth={depth} from={data.title} onOpenLink={openRecord}
      onSave={async values => {
        await api(`/api/tables/${tableId}/records/${id}`, { method: 'PATCH', body: { updated_at: data.record.updated_at, values: wire(values) } })
        await load()
      }} />
  )
}
