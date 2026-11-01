import { useState } from 'react'
import FieldEditor from './fields.jsx'
import History from './History.jsx'
import Files from '../files/Files.jsx'
import { api } from '../api.js'

export default function Card({ tableId, record, fields, onSave, onClose, onOpenLink, onChanged, equipment }) {
  const [draft, setDraft] = useState({})   // только изменённые поля
  const [saving, setSaving] = useState(false)

  const canEdit = fields.some(f => f.editable)   // editable в /fields — с учётом роли
  const valueOf = f => (f.column_name in draft ? draft[f.column_name] : record[f.column_name])

  async function save() {
    if (Object.keys(draft).length === 0) { onClose(); return }
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside style={{
      position: 'fixed', top: 0, right: 0, width: 420, height: '100vh', background: 'var(--bg)',
      borderLeft: '1px solid var(--line)', padding: 16, overflowY: 'auto', display: 'grid', gap: 12, alignContent: 'start',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>Запись №{record.id}</strong>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Закрыть</button>
      </div>
      {fields.map(f => f.kind === 'multipleAttachments' ? (
        // вложения меняются сразу, без «Сохранить»; править — если роль правит таблицу
        <Files key={f.column_name} title={f.title} files={record[f.column_name]}
          onUpload={canEdit && tableId ? async up => {
            await api(`/api/tables/${tableId}/records/${record.id}/attachments`, { method: 'POST', body: { column: f.column_name, ids: up.map(u => u.id) } })
            await onChanged?.()
          } : undefined}
          onRemove={canEdit && tableId ? async file => {
            await api(`/api/tables/${tableId}/records/${record.id}/attachments/${file.id}`, { method: 'DELETE' })
            await onChanged?.()
          } : undefined} />
      ) : (
        <FieldEditor
          key={f.column_name}
          field={f}
          value={valueOf(f)}
          onChange={v => setDraft(d => ({ ...d, [f.column_name]: v }))}
          onOpenLink={onOpenLink}
        />
      ))}
      {fields.some(f => f.editable) && <button className="btn primary" disabled={saving} onClick={save}>Сохранить</button>}
      {tableId && <History tableId={tableId} recordId={record.id} version={record.updated_at} fields={fields} />}
    </aside>
  )
}
