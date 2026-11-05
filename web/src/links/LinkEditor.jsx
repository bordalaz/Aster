import { useState } from 'react'
import { LINK_PILL } from '../grid/renderers.js'
import { Icon } from '../ui/icons.jsx'
import LinkSearch from './LinkSearch.jsx'
import { createLinked, openRecord } from './data.js'

// Связи прямо в ячейке сетки, как в Airtable: плашки с «×» и «+»; набор текста на ячейке — сразу поиск.
// Несколько записей: выбрал — поиск очищается и ждёт следующий номер; Esc или щелчок мимо — сохранить всё.
// Одна запись (prefersSingleRecordLink): выбор сохраняет сразу и закрывает правку.
export default function LinkEditor({ value: cell, onChange, onFinishedEditing, initialValue }) {
  const { link: field, value } = cell.data
  const single = !!field.options?.prefersSingleRecordLink
  const [adding, setAdding] = useState(!!initialValue)
  const withValue = v => ({ ...cell, data: { ...cell.data, value: v, items: v.map(x => ({ text: x.name, ...LINK_PILL })) } })
  const save = v => onFinishedEditing(withValue(v))
  const set = v => onChange(withValue(v))   // правка ещё открыта: сохранится при закрытии
  const pick = n => (single ? save([n]) : set([...value, n]))
  return (
    <div className="link-editor">
      <div className="link-editor-pills">
        {value.map(v => (
          <span key={v.id} className="fld-chip"><span className="pill" style={{ background: LINK_PILL.bg, borderRadius: 4 }}>{v.name || `№${v.id}`}</span>
            <button type="button" className="fld-chip-x" aria-label={`Убрать ${v.name}`} onClick={() => set(value.filter(x => x.id !== v.id))}>×</button>
          </span>
        ))}
        {(!single || !value.length) && (
          <button type="button" className="link-editor-add" aria-label="Добавить связь" onClick={() => setAdding(true)}><Icon name="plus" size={12} /></button>
        )}
      </div>
      {adding && (
        <LinkSearch field={field} exclude={value.map(v => v.id)} initial={initialValue ?? ''}
          onPick={pick} onClose={() => save(value)}
          onCreate={async q => { const n = await createLinked(field, q); save(single ? [n] : [...value, n]); openRecord(field.link_table, n.id) }} />
      )}
    </div>
  )
}
