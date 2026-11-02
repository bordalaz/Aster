import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import TableTabs from './tables/TableTabs.jsx'
import TableView from './grid/TableView.jsx'
import Users from './users/Users.jsx'
import Forms from './forms/Forms.jsx'
import Calibration from './calibration/Calibration.jsx'
import ChangePassword from './auth/ChangePassword.jsx'
import { Icon } from './ui/icons.jsx'

// Профиль, как в Airtable: кружок с инициалом → имя, «Пользователи» (админы), «Сменить пароль», «Выйти».
function ProfileMenu({ user, isAdmin, onUsers, onPassword, onLogout }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  const go = fn => () => { setOpen(false); fn() }
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="avatar" aria-label="Профиль" aria-expanded={open} onClick={() => setOpen(!open)}>
        {(user?.name ?? '?').trim().charAt(0).toUpperCase()}
      </button>
      {open && (
        <div className="pop menu" role="menu" style={{ right: 0, top: 40 }}>
          <div className="profile-head"><strong>{user?.name}</strong><span>{user?.login}</span></div>
          <div className="sep" />
          {isAdmin && <button role="menuitem" onClick={go(onUsers)}><Icon name="users" />Пользователи</button>}
          <button role="menuitem" onClick={go(onPassword)}><Icon name="key" />Сменить пароль</button>
          <div className="sep" />
          <button role="menuitem" onClick={go(onLogout)}><Icon name="signOut" />Выйти</button>
        </div>
      )}
    </div>
  )
}

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
          <ProfileMenu user={user} isAdmin={isAdmin} onUsers={() => setScreen('users')} onPassword={() => setScreen('password')} onLogout={onLogout} />
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
