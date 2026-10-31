import { useEffect, useState } from 'react'
import { api } from './api.js'
import TableList from './tables/TableList.jsx'
import TableView from './grid/TableView.jsx'

export default function Workspace({ user, onLogout }) {
  const [tables, setTables] = useState([])
  const [activeId, setActiveId] = useState(null)

  useEffect(() => {
    api('/api/tables').then(ts => {
      setTables(ts)
      setActiveId(prev => prev ?? ts[0]?.id ?? null)
    })
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <TableList tables={tables} activeId={activeId} onPick={setActiveId} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
          <strong>{tables.find(t => t.id === activeId)?.title ?? ''}</strong>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{user?.name}</span>
          <button className="btn" onClick={onLogout}>Выход</button>
        </header>
        {activeId && <TableView tableId={activeId} />}
      </main>
    </div>
  )
}
