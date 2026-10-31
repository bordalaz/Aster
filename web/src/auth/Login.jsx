import { useState } from 'react'
import { ApiError } from '../api.js'

export default function Login({ onLogin }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await onLogin(login, password)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Неверный логин или пароль' : 'Ошибка входа')
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 280, margin: '80px auto', display: 'grid', gap: 10 }}>
      <h1 style={{ fontSize: 18 }}>Вход</h1>
      <label>Логин<input value={login} onChange={e => setLogin(e.target.value)} autoFocus /></label>
      <label>Пароль<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <div className="err">{error}</div>}
      <button className="btn primary" type="submit">Войти</button>
    </form>
  )
}
