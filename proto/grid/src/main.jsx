import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { makeRows, cols } from './data.js'
import TanStackGrid from './TanStackGrid.jsx'
import GlideGrid from './GlideGrid.jsx'

const t0 = performance.now()
const g = new URLSearchParams(location.search).get('g') || 'tanstack'

function App() {
  const [rows, setRows] = useState(() => makeRows())
  useEffect(() => {
    requestAnimationFrame(() => {
      document.getElementById('t').textContent = `${g}: ${rows.length} строк, первый кадр ${Math.round(performance.now() - t0)} мс`
    })
  }, [])
  const update = (i, key, value) => setRows(r => { const n = r.slice(); n[i] = { ...n[i], [key]: value }; return n })
  const Grid = g === 'glide' ? GlideGrid : TanStackGrid
  return <Grid rows={rows} cols={cols} update={update} />
}
createRoot(document.getElementById('root')).render(<App />)
