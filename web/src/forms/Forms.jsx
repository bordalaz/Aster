import { useEffect, useState } from 'react'
import { api } from '../api.js'
import FormFill from './FormFill.jsx'

// Экран «Формы»: список доступных форм слева, заполнение справа (R12).
export default function Forms({ open }) {
  const [forms, setForms] = useState(null)
  const [active, setActive] = useState(null)
  useEffect(() => { api('/api/forms').then(setForms, () => setForms([])) }, [])
  // открыта кнопкой: форма — по id вида Airtable
  useEffect(() => {
    const f = open && forms?.find(x => x.airtable_id === open.form)
    if (f) setActive(f.id)
  }, [open, forms])
  const prefill = open && forms?.find(x => x.airtable_id === open.form)?.id === active ? open : null

  if (!forms) return <div style={{ padding: 16 }}>Загрузка…</div>
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <nav style={{ width: 280, borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 8, display: 'grid', gap: 4, alignContent: 'start' }}>
        {forms.length === 0 && <div style={{ color: 'var(--muted)' }}>Доступных форм нет</div>}
        {forms.map(f => (
          <button key={f.id} className="form-item" aria-pressed={active === f.id} onClick={() => setActive(f.id)}>
            {f.title}<small>{f.table}</small>
          </button>
        ))}
      </nav>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {active ? <FormFill key={`${active}-${prefill ? open.row.id : ''}`} formId={active} prefill={prefill} /> : <div style={{ padding: 16, color: 'var(--muted)' }}>Выберите форму слева</div>}
      </div>
    </div>
  )
}
