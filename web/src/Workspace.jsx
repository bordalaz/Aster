import { useEffect, useState } from 'react'
import { api } from './api.js'
import TableList from './tables/TableList.jsx'
import TableView from './grid/TableView.jsx'
import Users from './users/Users.jsx'
import ChangePassword from './auth/ChangePassword.jsx'

export default function Workspace({ user, onLogout }) {
  const [tables, setTables] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [screen, setScreen] = useState('table')   // 'table' | 'users' | 'password'
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin'

  useEffect(() => {
    api('/api/tables').then(ts => {
      setTables(ts)
      setActiveId(prev => prev ?? ts[0]?.id ?? null)
    })
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <TableList tables={tables} activeId={screen === 'table' ? activeId : null} onPick={id => { setActiveId(id); setScreen('table') }} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
          <strong>{screen === 'users' ? 'Пользователи' : screen === 'password' ? 'Смена пароля' : tables.find(t => t.id === activeId)?.title ?? ''}</strong>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{user?.name}</span>
          {isAdmin && <button className="btn" onClick={() => setScreen('users')}>Пользователи</button>}
          <button className="btn" onClick={() => setScreen('password')}>Пароль</button>
          <button className="btn" onClick={onLogout}>Выход</button>
        </header>
        {screen === 'users' && <Users me={user} />}
        {screen === 'password' && <ChangePassword onDone={() => setScreen('table')} onCancel={() => setScreen('table')} />}
        {screen === 'table' && activeId && <TableView tableId={activeId} primaryField={tables.find(t => t.id === activeId)?.primary_field} />}
      </main>
    </div>
  )
}
