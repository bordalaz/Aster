import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api.js'
import FieldEditor from '../card/fields.jsx'
import LinkPicker from './LinkPicker.jsx'

const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`.slice(0, 40))
const empty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)

// Заполнение формы (R12). Ключ отправки живёт до успеха: двойной клик и повтор после обрыва — одна запись (E6).
export default function FormFill({ formId }) {
  const [form, setForm] = useState(null)
  const [values, setValues] = useState({})
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const key = useRef(newKey())

  useEffect(() => {
    setForm(null); setValues({}); setDone(false); setError(''); key.current = newKey()
    api(`/api/forms/${formId}`).then(setForm, () => setError('Форма недоступна'))
  }, [formId])

  async function submit(e) {
    e.preventDefault()
    const missing = form.fields.filter(f => f.required && empty(values[f.column_name])).map(f => f.title)
    if (missing.length) { setError(`Заполните: ${missing.join(', ')}`); return }
    setError(''); setSending(true)
    try {
      const body = Object.fromEntries(Object.entries(values).filter(([, v]) => !empty(v)))
      await api(`/api/forms/${formId}/submit`, { method: 'POST', body: { key: key.current, values: body } })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError && typeof err.body?.detail === 'string' ? err.body.detail : 'Не удалось отправить — повторите')
    } finally {
      setSending(false)
    }
  }

  if (!form) return <div style={{ padding: 16 }}>{error || 'Загрузка…'}</div>
  if (done) {
    return (
      <div style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 560 }}>
        <strong>{form.title}</strong>
        <div>{form.after_message || 'Запись создана'}</div>
        <div><button className="btn primary" onClick={() => { setValues({}); setDone(false); key.current = newKey() }}>Заполнить ещё</button></div>
      </div>
    )
  }
  const set = col => v => setValues(prev => ({ ...prev, [col]: v }))
  return (
    <form onSubmit={submit} style={{ padding: 16, display: 'grid', gap: 14, maxWidth: 560, alignContent: 'start' }}>
      <strong>{form.title}</strong>
      {form.fields.map(f => {
        const title = f.required ? `${f.title} *` : f.title
        return (
          <div key={f.column_name}>
            {f.kind === 'multipleRecordLinks'
              ? <LinkPicker field={f} title={title} value={values[f.column_name]} onChange={set(f.column_name)} />
              : <FieldEditor field={{ ...f, title, editable: true }} value={values[f.column_name] ?? null} onChange={set(f.column_name)} />}
            {f.help && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{f.help}</div>}
          </div>
        )
      })}
      {error && <div className="err" role="alert">{error}</div>}
      <div><button className="btn primary" type="submit" disabled={sending}>Отправить</button></div>
    </form>
  )
}
