import { useState } from 'react'
import { LINK_PILL } from '../grid/renderers.js'
import { Icon } from '../ui/icons.jsx'
import LinkSearch from './LinkSearch.jsx'

// Связи прямо в ячейке сетки, как в Airtable: плашки с «×» и «+»; набор текста на ячейке — сразу поиск.
// Выбор или «×» сохраняет сразу и закрывает правку (Enter — открыть снова).
export default function LinkEditor({ value: cell, onFinishedEditing, initialValue }) {
  const { link: field, value } = cell.data
  const single = !!field.options?.prefersSingleRecordLink
  const [adding, setAdding] = useState(!!initialValue)
  const save = v => onFinishedEditing({ ...cell, data: { ...cell.data, value: v, items: v.map(x => ({ text: x.name, ...LINK_PILL })) } })
  return (
    <div className="link-editor">
      <div className="link-editor-pills">
        {value.map(v => (
          <span key={v.id} className="fld-chip"><span className="pill" style={{ background: LINK_PILL.bg, borderRadius: 4 }}>{v.name || `№${v.id}`}</span>
            <button type="button" className="fld-chip-x" aria-label={`Убрать ${v.name}`} onClick={() => save(value.filter(x => x.id !== v.id))}>×</button>
          </span>
        ))}
        {(!single || !value.length) && (
          <button type="button" className="link-editor-add" aria-label="Добавить связь" onClick={() => setAdding(true)}><Icon name="plus" size={12} /></button>
        )}
      </div>
      {adding && (
        <LinkSearch field={field} exclude={value.map(v => v.id)} initial={initialValue ?? ''}
          onPick={n => save(single ? [n] : [...value, n])} onClose={() => setAdding(false)} />
      )}
    </div>
  )
}
