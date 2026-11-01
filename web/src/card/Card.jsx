import { useEffect, useState } from 'react'
import FieldEditor from './fields.jsx'
import History from './History.jsx'
import Files from '../files/Files.jsx'
import { api } from '../api.js'
import { displayValue } from '../grid/cells.js'
import { fieldIcon, Icon } from '../ui/icons.jsx'

// сразу сохраняются — как в Airtable; текст и числа — при уходе с поля или Enter
const IMMEDIATE = new Set(['checkbox', 'singleSelect', 'multipleSelects', 'date', 'dateTime', 'duration'])

// Раскрытая запись как в Airtable: окно по центру; поля в порядке вида, остальные — под «Показать N скрытых полей».
// shown — колонки текущего вида по порядку (без него — все поля); onPrev/onNext — соседние записи сетки.
export default function Card({ tableId, record, fields, shown, primaryField, onSave, onClose, onPrev, onNext, onOpenLink, onChanged }) {
  const [draft, setDraft] = useState({})
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  useEffect(() => { setDraft({}); setError('') }, [record.id])
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const canEdit = fields.some(f => f.editable)   // editable в /fields — с учётом роли
  const valueOf = f => (f.column_name in draft ? draft[f.column_name] : record[f.column_name])
  const primary = fields.find(f => f.column_name === primaryField)
  const order = shown ?? fields.map(f => f.column_name)
  const visible = order.map(c => fields.find(f => f.column_name === c)).filter(f => f && f !== primary)
  const hidden = fields.filter(f => f !== primary && !order.includes(f.column_name))

  async function commit(col, value) {
    if (value === record[col]) { setDraft(d => { const { [col]: _, ...rest } = d; return rest }); return }
    setError('')
    try {
      await onSave({ [col]: value })
      setDraft(d => { const { [col]: _, ...rest } = d; return rest })
    } catch {
      setError('Не удалось сохранить поле — значение не изменено')
      setDraft(d => { const { [col]: _, ...rest } = d; return rest })
    }
  }
  const change = f => v => {
    setDraft(d => ({ ...d, [f.column_name]: v }))
    if (IMMEDIATE.has(f.kind)) commit(f.column_name, v)
  }
  const blur = f => () => { if (f.column_name in draft && !IMMEDIATE.has(f.kind)) commit(f.column_name, draft[f.column_name]) }

  const render = f => f.kind === 'multipleAttachments' ? (
    // вложения меняются сразу; править — если роль правит таблицу
    <div key={f.column_name} className="fld fld-inline">
      <span className="fld-label"><Icon name={fieldIcon(f.kind)} size={14} />{f.title}</span>
      <div className="fld-value">
        <Files bare title={f.title} files={record[f.column_name]}
          onUpload={canEdit && tableId ? async up => {
            await api(`/api/tables/${tableId}/records/${record.id}/attachments`, { method: 'POST', body: { column: f.column_name, ids: up.map(u => u.id) } })
            await onChanged?.()
          } : undefined}
          onRemove={canEdit && tableId ? async file => {
            await api(`/api/tables/${tableId}/records/${record.id}/attachments/${file.id}`, { method: 'DELETE' })
            await onChanged?.()
          } : undefined} />
      </div>
    </div>
  ) : (
    <div key={f.column_name} onBlur={blur(f)} onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur() }}>
      <FieldEditor inline field={f} value={valueOf(f)} onChange={change(f)} onOpenLink={onOpenLink} />
    </div>
  )

  const title = primary ? displayValue(primary, record[primary.column_name]) : `Запись №${record.id}`
  return (
    <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-head">
          <button className="quiet" aria-label="Предыдущая запись" disabled={!onPrev} onClick={onPrev}><Icon name="caretDown" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
          <button className="quiet" aria-label="Следующая запись" disabled={!onNext} onClick={onNext}><Icon name="caretDown" size={14} /></button>
          <span className="card-head-title">{title}</span>
          <button className="quiet" aria-label="Закрыть" onClick={onClose} style={{ marginLeft: 'auto' }}><Icon name="x" /></button>
        </header>
        <div className="card-body">
          {primary && <div className="card-primary"><Icon name={fieldIcon(primary.kind)} size={14} />{primary.title}</div>}
          <h2 className="card-title">{title}</h2>
          {error && <div className="err" role="alert">{error}</div>}
          {visible.map(render)}
          {hidden.length > 0 && (
            <div className="card-hidden">
              <button className="btn" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? 'Скрыть' : 'Показать'} {hidden.length} {hidden.length % 10 === 1 && hidden.length % 100 !== 11 ? 'скрытое поле'
                  : [2, 3, 4].includes(hidden.length % 10) && ![12, 13, 14].includes(hidden.length % 100) ? 'скрытых поля' : 'скрытых полей'}
                <Icon name="caretDown" size={12} style={showHidden ? { transform: 'rotate(180deg)' } : undefined} />
              </button>
            </div>
          )}
          {showHidden && hidden.map(render)}
          {tableId && <History tableId={tableId} recordId={record.id} version={record.updated_at} fields={fields} />}
        </div>
      </div>
    </div>
  )
}
