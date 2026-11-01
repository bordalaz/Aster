import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api.js'
import Files from '../files/Files.jsx'

const DAY = 86400000
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`.slice(0, 40))
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const TONE = { red: 'var(--danger, #D93025)', orange: 'var(--warn, #F08A24)', gray: 'var(--muted)' }

// Срок калибровки (R20): год от даты; прошёл — красный; ≤ 5 дней — оранжевый; иначе «осталось N дн.».
export function due(date, today = new Date()) {
  const d = new Date(`${date}T00:00:00Z`)
  const end = Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((end - now) / DAY)
  if (days < 0) return { tone: 'red', text: `просрочено на ${-days} дн.` }
  return { tone: days <= 5 ? 'orange' : 'gray', text: `осталось ${days} дн.` }
}

const errText = e => (e instanceof ApiError && typeof e.body?.detail === 'string' ? e.body.detail : 'Не удалось сохранить')

// Экран «Калибровка»: запись события (R22, R23) и матрица МИР × кожух (R24).
export default function Calibration({ user }) {
  const [eq, setEq] = useState(null)
  const [matrix, setMatrix] = useState(null)
  const [form, setForm] = useState({ date: todayIso(), equipment: '', housing: '', note: '' })
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(null)   // ячейка матрицы: {mir, id}
  const key = useRef(newKey())
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin'

  const load = useCallback(() => Promise.all([
    api('/api/calibration/equipment').then(setEq),
    api('/api/calibration/matrix').then(setMatrix),
  ]).catch(() => setError('Калибровки недоступны')), [])
  useEffect(() => { load() }, [load])

  const isMir = eq?.mirs.some(m => String(m.id) === form.equipment)
  async function submit(e) {
    e.preventDefault()
    if (!form.equipment) { setError('Выберите прибор'); return }
    if (isMir && !form.housing) { setError('Выберите кожух'); return }
    setError(''); setSending(true)
    try {
      await api('/api/calibrations', { method: 'POST', body: {
        key: key.current, date: form.date, equipment_id: Number(form.equipment), note: form.note || null,
        ...(isMir ? { housing_id: Number(form.housing) } : {}), files: isMir ? files.map(f => f.id) : [],
      } })
      key.current = newKey(); setDone(true); setFiles([]); setForm(f => ({ ...f, housing: '', note: '' }))
      await load()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSending(false)
    }
  }

  if (!eq || !matrix) return <div style={{ padding: 16 }}>{error || 'Загрузка…'}</div>
  const set = k => e => { setDone(false); setForm(f => ({ ...f, [k]: e.target.value })) }
  const cell = new Map(matrix.cells.map(c => [`${c.mir}:${c.housing}`, c]))
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'grid', gap: 24, alignContent: 'start' }}>
      {isAdmin && eq.unknown_sizes.map(p => <SizeHint key={p} pattern={p} onSaved={load} />)}

      <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 560 }}>
        <strong>Записать калибровку</strong>
        <label>Дата<br /><input type="date" aria-label="Дата" required value={form.date} onChange={set('date')} /></label>
        <label>Прибор<br />
          <select aria-label="Прибор" value={form.equipment} onChange={set('equipment')} style={{ maxWidth: '100%' }}>
            <option value="">—</option>
            <optgroup label="МИР (в паре с кожухом)">{eq.mirs.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
            <optgroup label="Инклинометр, гамма-зонд, резистивиметр — только дата">
              {eq.singles.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </optgroup>
          </select>
        </label>
        {isMir && <>
          <label>Кожух<br />
            <select aria-label="Кожух" value={form.housing} onChange={set('housing')} style={{ maxWidth: '100%' }}>
              <option value="">—</option>
              {eq.housings.map(h => <option key={h.id} value={h.id}>{h.name}{h.size ? ` (${h.size})` : ''}</option>)}
            </select>
          </label>
          <Files title="Файлы калибровки" files={files} onUpload={up => setFiles(f => [...f, ...up])}
            onRemove={x => setFiles(f => f.filter(y => y.id !== x.id))} />
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Файлы получат имя вида МИР-099_КОЖУХ-145_4.75_{form.date}.cal</div>
        </>}
        <label>Примечание<br /><textarea aria-label="Примечание" rows={2} maxLength={2000} value={form.note} onChange={set('note')} style={{ width: '100%' }} /></label>
        {error && <div className="err" role="alert">{error}</div>}
        {done && <div>Калибровка записана</div>}
        <div><button className="btn primary" type="submit" disabled={sending}>Записать калибровку</button></div>
      </form>

      <div style={{ display: 'grid', gap: 8 }}>
        <strong>Матрица калибровок МИР × кожух</strong>
        <div style={{ overflow: 'auto', maxWidth: '100%' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th />{matrix.housings.map(h => (
              // номер кожуха — главное, размер (121/130) — мелко; полное имя — по наведению (E18)
              <th key={h.id} title={h.name} style={{ ...ellipsis, maxWidth: 110, padding: 4, textAlign: 'left' }}>
                <div className="mono">№ {h.name.split('_№_')[1] ?? h.name}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 'normal' }}>{h.name.match(/\d+\/\d+/)?.[0] ?? ''}</div>
              </th>
            ))}</tr></thead>
            <tbody>{matrix.mirs.map(m => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--line)' }}>
                <th title={m.name} style={{ ...ellipsis, maxWidth: 140, padding: 4, textAlign: 'left' }}>{m.name}</th>
                {matrix.housings.map(h => {
                  const c = cell.get(`${m.id}:${h.id}`)
                  if (!c) return <td key={h.id} style={{ padding: 4, color: 'var(--muted)' }} />
                  const d = due(c.date)
                  return (
                    <td key={h.id} style={{ padding: 2 }}>
                      <button type="button" className="btn mono" title={d.text} style={{ color: TONE[d.tone] }}
                        onClick={() => setOpen({ mir: m.id, id: c.id })}>
                        {c.date}{c.count > 1 ? ` +${c.count - 1}` : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        {open && <OneCalibration {...open} onClose={() => setOpen(null)} />}
      </div>
    </div>
  )
}

function OneCalibration({ mir, id, onClose }) {
  const [cal, setCal] = useState(null)
  useEffect(() => { api(`/api/calibrations?equipment_id=${mir}`).then(cs => setCal(cs.find(c => c.id === id) ?? null)) }, [mir, id])
  if (!cal) return null
  return (
    <div style={{ border: '1px solid var(--line)', padding: 10, maxWidth: 560, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <strong className="mono">{cal.date}</strong>
        <span>{cal.equipment.name} × {cal.housing?.name}</span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Закрыть</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cal.by ?? ''}{cal.note ? ` — ${cal.note}` : ''}</div>
      <Files title="Файлы" files={cal.files} />
    </div>
  )
}

function SizeHint({ pattern, onSaved }) {
  const [size, setSize] = useState('')
  const [error, setError] = useState('')
  async function save() {
    try { await api('/api/calibration/sizes', { method: 'PUT', body: { pattern, size } }); await onSaved() } catch (e) { setError(errText(e)) }
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--warn, #F08A24)' }}>
      <span>Добавьте габарит для {pattern} — без него имена файлов калибровки будут без габарита.</span>
      <input aria-label={`Габарит ${pattern}`} value={size} onChange={e => setSize(e.target.value)} placeholder="6.75" style={{ width: 60 }} />
      <button className="btn" onClick={save} disabled={!size}>Сохранить</button>
      {error && <span className="err">{error}</span>}
    </div>
  )
}

