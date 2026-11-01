import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import TableList from './tables/TableList.jsx'
import TableView from './grid/TableView.jsx'
import Users from './users/Users.jsx'
import Forms from './forms/Forms.jsx'
import Calibration from './calibration/Calibration.jsx'
import ChangePassword from './auth/ChangePassword.jsx'

export default function Workspace({ user, onLogout }) {
  const [tables, setTables] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [screen, setScreen] = useState('table')   // 'table' | 'forms' | 'calibration' | 'users' | 'password'
  const [jump, setJump] = useState(null)          // id записи, открыть после перехода по связи
  const openLink = useCallback((tableId, recordId) => { setActiveId(tableId); setJump(recordId); setScreen('table') }, [])
  const opened = useCallback(() => setJump(null), [])
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
          <strong>{screen === 'forms' ? 'Формы' : screen === 'calibration' ? 'Калибровка' : screen === 'users' ? 'Пользователи' : screen === 'password' ? 'Смена пароля' : tables.find(t => t.id === activeId)?.title ?? ''}</strong>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{user?.name}</span>
          <button className="btn" aria-pressed={screen === 'forms'} onClick={() => setScreen('forms')}>Формы</button>
          <button className="btn" aria-pressed={screen === 'calibration'} onClick={() => setScreen('calibration')}>Калибровка</button>
          {isAdmin && <button className="btn" onClick={() => setScreen('users')}>Пользователи</button>}
          <button className="btn" onClick={() => setScreen('password')}>Пароль</button>
          <button className="btn" onClick={onLogout}>Выход</button>
        </header>
        {screen === 'forms' && <Forms />}
        {screen === 'calibration' && <Calibration user={user} />}
        {screen === 'users' && <Users me={user} />}
        {screen === 'password' && <ChangePassword onDone={() => setScreen('table')} onCancel={() => setScreen('table')} />}
        {screen === 'table' && activeId && <TableView key={activeId} user={user} tableId={activeId} title={tables.find(t => t.id === activeId)?.title} primaryField={tables.find(t => t.id === activeId)?.primary_field}
          openId={jump} onOpened={opened} onOpenLink={openLink} />}
      </main>
    </div>
  )
}
