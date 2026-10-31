import { useEffect, useState } from 'react'
import { api } from './api.js'

export default function Workspace() {
  const [tables, setTables] = useState([])
  useEffect(() => { api('/api/tables').then(setTables) }, [])
  return <div>{tables.map(t => <div key={t.id}>{t.title}</div>)}</div>
}
