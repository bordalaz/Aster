import { createContext, useContext, useState } from 'react'
import { api } from '../api.js'
import FieldEditor from './fields.jsx'
import Files from '../files/Files.jsx'
import { buttonStyle } from '../grid/renderers.js'
export { buttonStyle }

// Поля-кнопки Airtable (options.action из migrate/buttons.py):
//   form   — открыть нашу форму с подставленными значениями (как ?prefill_ в ссылке Airtable);
//   edit   — окно правки нескольких полей этой записи (бывшие формы служебных таблиц ЗИП);
//   script — скрипты Airtable не перенесены: кнопка неактивна.
export const ButtonRun = createContext(null)


const SCRIPT = 'Скрипты Airtable не перенесены'

export function FieldButton({ field, row }) {
  const run = useContext(ButtonRun)
  const o = field.options ?? {}
  const off = !run || !o.action || o.action.kind === 'script'
  return (
    <button type="button" className="fb" style={buttonStyle(o.variant)} disabled={off} title={o.action?.kind === 'script' ? SCRIPT : field.title}
      onClick={e => { e.stopPropagation(); run(field, row) }}>{o.label ?? field.title}</button>
  )
}

// Значения формы из записи: связь → id записей (или названия, если поле формы не связь), выбор/текст — как есть.
export function prefillValues(action, row, targetKinds = {}) {
  const out = {}
  for (const p of action.prefill ?? []) {
    let v = 'value' in p ? p.value : p.record ? [row.id] : row[p.from]
    if (Array.isArray(v) && v.some(x => x && typeof x === 'object' && 'id' in x)) {
      v = targetKinds[p.col] === 'multipleRecordLinks' ? v.map(x => x.id) : v.map(x => x.name).join(', ')
    }
    if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[p.col] = v
  }
  return out
}

// Открыть форму: экран «Формы» слушает это событие (Workspace).
export function openForm(action, row) {
  window.dispatchEvent(new CustomEvent('aster:open-form', { detail: { form: action.form, row, action } }))
}

export function ButtonDialog({ field, row, tableId, fields, primaryField, onSave, onChanged, onClose }) {
  const byCol = Object.fromEntries(fields.map(f => [f.column_name, f]))
  const items = (field.options?.action?.fields ?? []).filter(x => byCol[x.col])
  const [draft, setDraft] = useState(() => Object.fromEntries(items.filter(x => byCol[x.col].kind !== 'multipleAttachments').map(x => [x.col, row[x.col] ?? null])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const name = byCol[primaryField] ? String(row[primaryField] ?? '') : ''
  const editable = items.every(x => byCol[x.col].editable || byCol[x.col].kind === 'multipleAttachments') && fields.some(f => f.editable)

  async function save(e) {
    e.preventDefault()
    const missing = items.filter(x => x.required && (draft[x.col] ?? row[x.col]) == null).map(x => byCol[x.col].title)
    if (missing.length) { setError(`Заполните: ${missing.join(', ')}`); return }
    setBusy(true); setError('')
    try { if (Object.keys(draft).length) await onSave(draft); onClose() }
    catch { setError('Не удалось сохранить') }
    finally { setBusy(false) }
  }

  return (
    <div className="card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="send" role="dialog" aria-modal="true" aria-label={field.title} onSubmit={save}>
        <button type="button" className="send-x" aria-label="Закрыть" onClick={onClose}>×</button>
        <h2>{field.title}</h2>
        {name && <p className="fb-rec">{byCol[primaryField].title}: <b>{name}</b></p>}
        {items.map(x => {
          const f = byCol[x.col], title = x.required ? `${f.title} *` : f.title
          return (
            <div key={x.col}>
              {f.kind === 'multipleAttachments'
                ? <Files title={title} files={row[x.col]}
                    onUpload={editable ? async up => {
                      await api(`/api/tables/${tableId}/records/${row.id}/attachments`, { method: 'POST', body: { column: x.col, ids: up.map(u => u.id) } })
                      await onChanged?.()
                    } : undefined} />
                : <FieldEditor field={{ ...f, title, editable: editable && f.editable }} value={draft[x.col]} onChange={v => setDraft(d => ({ ...d, [x.col]: v }))} />}
              {x.help && <div className="fb-help">{x.help}</div>}
            </div>
          )
        })}
        {!editable && <div className="err">Править эту запись может администратор</div>}
        {error && <div className="err" role="alert">{error}</div>}
        <div className="send-foot">
          <button type="button" className="btn" onClick={onClose}>{Object.keys(draft).length ? 'Отмена' : 'Готово'}</button>
          {editable && Object.keys(draft).length > 0 && <button type="submit" className="btn primary" disabled={busy}>Сохранить</button>}
        </div>
      </form>
    </div>
  )
}
