import { useEffect, useState } from 'react'
import { api, ApiError } from '../api.js'

const KIND = { to: 'ТО', defect: 'Дефектоскопия', calib: 'Калибровка' }
const num = v => (v === '' || v == null ? null : Number(v))

// Регламент ТО (R17): правила смотрят все, пороги в часах и месяцах правят админы. Подсказки — рекомендательные (R18).
export default function Rules({ user }) {
  const [rules, setRules] = useState(null)
  const [draft, setDraft] = useState({})
  const [msg, setMsg] = useState('')
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin'
  const load = () => api('/api/maintenance/rules').then(setRules, () => setRules([]))
  useEffect(() => { load() }, [])

  async function save(r) {
    const d = { hours: r.hours, months: r.months, ...draft[r.id] }
    try {
      await api(`/api/maintenance/rules/${r.id}`, { method: 'PATCH', body: { hours: num(d.hours), months: num(d.months) } })
      setDraft(x => ({ ...x, [r.id]: undefined }))
      setMsg('Сохранено')
      await load()
    } catch (e) {
      setMsg(e instanceof ApiError && typeof e.body?.detail === 'string' ? e.body.detail : 'Не удалось сохранить')
    }
  }

  if (!rules) return <div style={{ padding: 16 }}>Загрузка…</div>
  const cell = { padding: '6px 8px', textAlign: 'left', verticalAlign: 'top' }
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
        Подсказки регламента рекомендательные: ничего не блокируют, уровень ТО выбирает мастер. Наработка — сумма циркуляции
        законченных рейсов после события из колонки «Отсчёт с».
      </div>
      {msg && <div role="status">{msg}</div>}
      <table style={{ borderCollapse: 'collapse', fontSize: 13, maxWidth: 1100 }}>
        <thead><tr style={{ color: 'var(--muted)', fontSize: 12 }}>
          <th style={cell}>Модули</th><th style={cell}>Что</th><th style={cell}>Порог, ч</th><th style={cell}>Порог, мес.</th>
          <th style={cell}>Отсчёт с</th>{isAdmin && <th />}
        </tr></thead>
        <tbody>{rules.map(r => {
          const d = { hours: r.hours ?? '', months: r.months ?? '', ...draft[r.id] }
          const edit = isAdmin && !r.on_arrival
          const what = r.kind === 'to' ? r.level : KIND[r.kind]
          const input = k => (edit
            ? <input type="number" min="1" aria-label={`${k === 'hours' ? 'Часы' : 'Месяцы'}: ${r.match.join(', ')} ${what}`}
                value={d[k]} style={{ width: 80 }}
                onChange={e => setDraft(x => ({ ...x, [r.id]: { ...x[r.id], [k]: e.target.value } }))} />
            : (r[k] ?? '—'))
          return (
            <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={cell}>{r.match.map(m => m.replace(/^тип:/, 'всё ')).join(', ')}</td>
              <td style={cell}>{what}{r.on_arrival ? ' — при поступлении на базу' : ''}</td>
              <td style={cell}>{input('hours')}</td>
              <td style={cell}>{input('months')}</td>
              <td style={cell}>{r.on_arrival ? 'поступление на базу' : r.resets.join(', ')}</td>
              {isAdmin && <td style={cell}>{edit && draft[r.id] && <button className="btn" onClick={() => save(r)}>Сохранить</button>}</td>}
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}
