import { useEffect, useState } from 'react'
import { api } from '../api.js'
import FormFill from './FormFill.jsx'

// Экран «Формы»: список доступных форм слева, заполнение справа (R12).
export default function Forms() {
  const [forms, setForms] = useState(null)
  const [active, setActive] = useState(null)
  useEffect(() => { api('/api/forms').then(setForms, () => setForms([])) }, [])

  if (!forms) return <div style={{ padding: 16 }}>Загрузка…</div>
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <nav style={{ width: 280, borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 8, display: 'grid', gap: 4, alignContent: 'start' }}>
        {forms.length === 0 && <div style={{ color: 'var(--muted)' }}>Доступных форм нет</div>}
        {forms.map(f => (
          <button key={f.id} className="btn" aria-pressed={active === f.id} style={{ textAlign: 'left', whiteSpace: 'normal' }}
            onClick={() => setActive(f.id)}>
            {f.title}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.table}</div>
          </button>
        ))}
      </nav>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {active ? <FormFill key={active} formId={active} /> : <div style={{ padding: 16, color: 'var(--muted)' }}>Выберите форму слева</div>}
      </div>
    </div>
  )
}
