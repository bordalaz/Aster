import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import TableTabs from './tables/TableTabs.jsx'
import TableView from './grid/TableView.jsx'
import Users from './users/Users.jsx'
import Forms from './forms/Forms.jsx'
import Calibration from './calibration/Calibration.jsx'
import ChangePassword from './auth/ChangePassword.jsx'
import { Icon } from './ui/icons.jsx'

// Оболочка как в Airtable: верхняя полоса базы с разделами, под ней вкладки таблиц.
export default function Workspace({ user, onLogout }) {
  const [tables, setTables] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [screen, setScreen] = useState('table')   // 'table' | 'forms' | 'calibration' | 'users' | 'password'
  const [jump, setJump] = useState(null)          // id записи, открыть после перехода по связи
  const openLink = useCallback((tableId, recordId) => { setActiveId(tableId); setJump(recordId); setScreen('table') }, [])
  const opened = useCallback(() => setJump(null), [])
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin'

  const TABLE_KEY = `aster.table.${user?.id ?? 0}`   // последняя открытая таблица — как Airtable
  useEffect(() => {
    api('/api/tables').then(ts => {
      setTables(ts)
      let last = null
      try { last = Number(localStorage.getItem(TABLE_KEY)) } catch { /* нет хранилища */ }
      setActiveId(prev => prev ?? (ts.some(t => t.id === last) ? last : ts[0]?.id ?? null))
    })
  }, [TABLE_KEY])
  useEffect(() => {
    if (activeId != null) try { localStorage.setItem(TABLE_KEY, String(activeId)) } catch { /* приватный режим */ }
  }, [TABLE_KEY, activeId])

  const section = s => (screen === s ? 'page' : undefined)
  const active = tables.find(t => t.id === activeId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="topbar" style={{ position: 'relative' }}>
        <div className="base">
          <span className="base-mark"><Icon name="database" size={16} /></span>
          <span>Воркспэйс гидроканал</span>
        </div>
        <nav aria-label="Разделы">
          <button aria-current={section('table')} onClick={() => setScreen('table')}>Данные</button>
          <button aria-current={section('forms')} onClick={() => setScreen('forms')}>Формы</button>
        </nav>
        <div className="right">
          {/* ponytail: калибровка скрыта до конца переноса Airtable 1:1 */}
          {isAdmin && <button className="quiet" aria-current={section('users')} onClick={() => setScreen('users')}><Icon name="users" />Пользователи</button>}
          <button className="quiet" onClick={() => setScreen('password')}><Icon name="key" />Пароль</button>
          <span style={{ color: 'var(--muted)', padding: '0 4px' }}>{user?.name}</span>
          <button className="quiet" onClick={onLogout} aria-label="Выход" title="Выход"><Icon name="signOut" /></button>
        </div>
      </header>
      {screen === 'table' && <TableTabs tables={tables} activeId={activeId} onPick={setActiveId}
        onHide={isAdmin ? async (id, hidden) => {
          await api(`/api/tables/${id}`, { method: 'PATCH', body: { hidden } })
          setTables(ts => ts.map(t => (t.id === id ? { ...t, hidden } : t)))
        } : undefined} />}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {screen === 'forms' && <Forms />}
        {screen === 'calibration' && <Calibration user={user} />}
        {screen === 'users' && <Users me={user} />}
        {screen === 'password' && <ChangePassword onDone={() => setScreen('table')} onCancel={() => setScreen('table')} />}
        {screen === 'table' && active && <TableView key={activeId} user={user} tableId={activeId} title={active.title}
          primaryField={active.primary_field} openId={jump} onOpened={opened} onOpenLink={openLink} />}
      </main>
    </div>
  )
}
