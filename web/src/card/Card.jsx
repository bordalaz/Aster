import { useState } from 'react'
import FieldEditor from './fields.jsx'

export default function Card({ record, fields, onSave, onClose }) {
  const [draft, setDraft] = useState({})   // только изменённые поля
  const [saving, setSaving] = useState(false)

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
      {fields.map(f => (
        <FieldEditor
          key={f.column_name}
          field={f}
          value={valueOf(f)}
          onChange={v => setDraft(d => ({ ...d, [f.column_name]: v }))}
        />
      ))}
      <button className="btn primary" disabled={saving} onClick={save}>Сохранить</button>
    </aside>
  )
}
