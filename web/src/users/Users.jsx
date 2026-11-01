import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api.js'

const ROLES = { superadmin: 'Суперадмин', admin: 'Админ', storekeeper: 'Кладовщик', user: 'Пользователь' }

const errText = e => (e instanceof ApiError && e.body?.detail && typeof e.body.detail === 'string')
  ? e.body.detail : 'Не удалось сохранить'

// Управление пользователями (R2, R3, R6). Права проверяет сервер; здесь только прячем недоступное.
export default function Users({ me }) {
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({ login: '', name: '', role: 'user', password: '' })
  const [reset, setReset] = useState({})   // id → временный пароль для сброса

  const load = useCallback(() => api('/api/users').then(setUsers), [])
  useEffect(() => { load() }, [load])

  const roles = me.role === 'superadmin' ? ['admin', 'storekeeper', 'user'] : ['storekeeper', 'user']
  // кого текущий может менять: суперадмина — никто, админов — только суперадмин
  const canTouch = u => u.role !== 'superadmin' && (u.role !== 'admin' || me.role === 'superadmin')

  async function run(fn) {
    setError('')
    try { await fn(); await load() } catch (e) { setError(errText(e)) }
  }

  const create = e => {
    e.preventDefault()
    if (form.password.length < 8) return setError('Временный пароль — не короче 8 символов')
    run(async () => {
      await api('/api/users', { method: 'POST', body: form })
      setForm({ login: '', name: '', role: 'user', password: '' })
    })
  }
  const patch = (id, body) => run(() => api(`/api/users/${id}`, { method: 'PATCH', body }))

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      {error && <div className="err" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
            <th>Логин</th><th>ФИО</th><th>Роль</th><th>Финансы</th><th>Состояние</th><th>Сброс пароля</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} style={{ borderTop: '1px solid var(--line)', height: 40 }}>
              <td className="mono">{u.login}</td>
              <td>{u.name}</td>
              <td>
                {canTouch(u) && u.id !== me.id
                  ? <select aria-label={`Роль ${u.login}`} value={u.role} onChange={e => patch(u.id, { role: e.target.value })}>
                      {[...new Set([u.role, ...roles])].map(r => <option key={r} value={r}>{ROLES[r]}</option>)}
                    </select>
                  : ROLES[u.role]}
              </td>
              <td title="Просмотр финансовых таблиц и полей из них; админы видят всегда, выдаёт суперадмин">
                {u.role === 'superadmin' || u.role === 'admin' ? 'да'
                  : me.role === 'superadmin'
                    ? <input type="checkbox" aria-label={`Финансы ${u.login}`} checked={!!u.finance_access}
                        onChange={e => patch(u.id, { finance_access: e.target.checked })} />
                    : u.finance_access ? 'да' : 'нет'}
              </td>
              <td>
                {u.blocked ? 'Заблокирован' : u.must_change_password ? 'Временный пароль' : 'Активен'}
                {canTouch(u) && u.id !== me.id &&
                  <button className="btn" style={{ marginLeft: 8 }} onClick={() => patch(u.id, { blocked: !u.blocked })}>
                    {u.blocked ? 'Разблокировать' : 'Заблокировать'}
                  </button>}
              </td>
              <td>
                {canTouch(u) && u.id !== me.id && <>
                  <input type="password" aria-label={`Новый временный пароль ${u.login}`} placeholder="временный пароль"
                    value={reset[u.id] ?? ''} onChange={e => setReset({ ...reset, [u.id]: e.target.value })} style={{ width: 140 }} />
                  <button className="btn" style={{ marginLeft: 6 }} disabled={(reset[u.id] ?? '').length < 8}
                    onClick={() => { patch(u.id, { password: reset[u.id] }); setReset({ ...reset, [u.id]: '' }) }}>Сбросить</button>
                </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 20, flexWrap: 'wrap' }}>
        <label>Логин<br /><input value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} /></label>
        <label>ФИО<br /><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>Роль<br />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {roles.map(r => <option key={r} value={r}>{ROLES[r]}</option>)}
          </select>
        </label>
        <label>Временный пароль<br /><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        <button className="btn primary" type="submit" disabled={!form.login || !form.name}>Создать</button>
      </form>
    </div>
  )
}
