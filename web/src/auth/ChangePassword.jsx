import { useState } from 'react'
import { api, ApiError } from '../api.js'

// Смена своего пароля. forced — первый вход с временным паролем (E3): без смены дальше не пускаем.
export default function ChangePassword({ forced, onDone, onCancel }) {
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (next.length < 8) return setError('Новый пароль — не короче 8 символов')
    if (next !== again) return setError('Пароли не совпадают')
    setError('')
    try {
      await api('/api/auth/password', { method: 'POST', body: { old, new: next } })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Текущий пароль неверный' : 'Не удалось сменить пароль')
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 300, margin: '80px auto', display: 'grid', gap: 10 }}>
      <h1 style={{ fontSize: 18 }}>Смена пароля</h1>
      {forced && <p style={{ margin: 0, color: 'var(--muted)' }}>Вы вошли с временным паролем. Задайте свой, чтобы продолжить.</p>}
      <label>Текущий пароль<input type="password" value={old} onChange={e => setOld(e.target.value)} autoFocus /></label>
      <label>Новый пароль<input type="password" value={next} onChange={e => setNext(e.target.value)} /></label>
      <label>Новый пароль ещё раз<input type="password" value={again} onChange={e => setAgain(e.target.value)} /></label>
      {error && <div className="err">{error}</div>}
      <button className="btn primary" type="submit">Сменить пароль</button>
      {onCancel && <button className="btn" type="button" onClick={onCancel}>Отмена</button>}
    </form>
  )
}
