import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Files from '../files/Files.jsx'

// Калибровки прибора в карточке (R22): у МИРа и у кожуха — одни и те же записи. Нет калибровок — ничего.
export default function CalibrationList({ equipmentId }) {
  const [cals, setCals] = useState([])
  useEffect(() => { api(`/api/calibrations?equipment_id=${equipmentId}`).then(setCals, () => setCals([])) }, [equipmentId])
  if (!cals.length) return null
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Калибровки</div>
      {cals.map(c => (
        <div key={c.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <div><span className="mono">{c.date}</span> · {c.equipment.name}{c.housing ? ` × ${c.housing.name}` : ''}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.by ?? ''}{c.note ? ` — ${c.note}` : ''}</div>
          {c.files.length > 0 && <Files title="Файлы" files={c.files} />}
        </div>
      ))}
    </div>
  )
}
