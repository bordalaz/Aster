import { useState } from 'react'
import { HUE_SHADES } from '../grid/renderers.js'
import { numText } from '../grid/cells.js'

// Оттенки Airtable в порядке, который проходит проверки различимости (в т.ч. при дальтонизме) —
// dataviz/validate_palette.js: все PASS. Порядок фиксированный, по кругу не идёт (больше 9 — «Другое»).
export const PALETTE = ['#2d7ff9', '#d74d26', '#06a09b', '#b2158b', '#b87503', '#8b46ff', '#338a17', '#f82b60', '#0b76b7']
const HUE_SLOT = { blue: 0, orange: 1, teal: 2, pink: 3, yellow: 4, purple: 5, green: 6, red: 7, cyan: 8 }
const OTHER_COLOR = '#888c94'

// Цвет следует за значением, а не за местом: у вариантов выбора — их оттенок из Airtable.
export function colorsFor(groups, field) {
  const choice = Object.fromEntries((field?.options?.choices ?? field?.options?.result?.options?.choices ?? [])
    .map(c => [c.name, /^[a-z]+/.exec(c.color ?? '')?.[0]]))
  let next = 0
  const used = new Set()
  return groups.map(g => {
    if (g === 'Другое') return OTHER_COLOR
    const slot = HUE_SLOT[choice[g]]
    if (slot != null && !used.has(slot)) { used.add(slot); return PALETTE[slot] }
    while (used.has(next % PALETTE.length) && used.size < PALETTE.length) next++
    used.add(next % PALETTE.length)
    return PALETTE[next++ % PALETTE.length]
  })
}

export function fmt(field, n, agg) {
  if (n == null) return '—'
  if (agg === 'count' || agg === 'unique' || agg === 'filled' || !field) return n.toLocaleString('ru-RU')
  const t = numText(field, n)
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : t
}

const TILE = { lightBlue: 'blue', lightGreen: 'green', lightYellow: 'yellow', lightPink: 'pink', lightRed: 'red',
  lightPurple: 'purple', lightTeal: 'teal', lightCyan: 'cyan', lightOrange: 'orange', textGray: 'gray' }

export function Tile({ label, value, color }) {
  const hue = HUE_SHADES[TILE[color] ?? 'gray']
  return (
    <div className="dash-tile" style={{ background: color === 'textGray' ? '#fff' : hue[0] }}>
      <div className="dash-tile-num">{value}</div>
      <div className="dash-tile-label">{label}</div>
    </div>
  )
}

function Legend({ groups, colors }) {
  if (groups.length < 2) return null
  return (
    <ul className="dash-legend">
      {groups.map((g, i) => <li key={g}><i style={{ background: colors[i] }} />{g}</li>)}
    </ul>
  )
}

// Таблица значений под графиком — для тех, кто не различает цвета, и для точных чисел.
function DataTable({ xs, groups, value, show }) {
  return (
    <details className="dash-table">
      <summary>Таблица</summary>
      <table>
        <thead><tr><th />{groups.map(g => <th key={g}>{g ?? 'Значение'}</th>)}</tr></thead>
        <tbody>{xs.map(x => <tr key={x}><th>{x}</th>{groups.map(g => <td key={g}>{show(value(x, g))}</td>)}</tr>)}</tbody>
      </table>
    </details>
  )
}

const niceMax = m => {
  if (m <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(m)), r = m / p
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p
}

// Столбцы со стопкой по группе: тонкие, 2px зазор между сегментами, сетка и оси приглушены.
export function BarChart({ s, colors, show, height }) {
  const [tip, setTip] = useState(null)
  const W = 640, H = height, L = 56, B = 40, T = 8
  const totals = s.xs.map(x => s.groups.reduce((a, g) => a + s.value(x, g), 0))
  const max = niceMax(Math.max(0, ...totals))
  const bw = Math.min(48, ((W - L) / Math.max(1, s.xs.length)) * 0.6)
  const step = (W - L) / Math.max(1, s.xs.length)
  const y = v => T + (H - T - B) * (1 - v / max)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)
  const every = Math.ceil(s.xs.length / Math.floor((W - L) / 56))   // подписи X не налезают друг на друга
  return (
    <div className="dash-chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Столбчатая диаграмма">
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="dash-axis">{show(t)}</text>
          </g>
        ))}
        {s.xs.map((x, i) => {
          let acc = 0
          const cx = L + step * i + step / 2
          return (
            <g key={x}>
              {s.groups.map((g, gi) => {
                const v = s.value(x, g)
                if (!v) return null
                const y0 = y(acc), y1 = y(acc + v)
                acc += v
                return <rect key={g} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1 - 2)} rx={2}
                  fill={colors[gi]} onMouseMove={e => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, x0: x, g, v })} />
              })}
              {i % every === 0 && <text x={cx} y={H - B + 16} textAnchor="middle" className="dash-axis">{x}</text>}
            </g>
          )
        })}
      </svg>
      {tip && <div className="dash-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
        <strong>{tip.x0}</strong>{tip.g != null && <span>{tip.g}</span>}<span>{show(tip.v)}</span></div>}
      <Legend groups={s.groups.filter(g => g != null)} colors={colors} />
      <DataTable xs={s.xs} groups={s.groups} value={s.value} show={show} />
    </div>
  )
}

// Круговая: срезы по убыванию, 2px зазор цвета фона, подписи — в легенде с долей.
export function PieChart({ s, colors, show, height }) {
  const [tip, setTip] = useState(null)
  const parts = s.xs.map((x, i) => ({ x, v: s.value(x, null), c: colors[i] })).filter(p => p.v > 0).sort((a, b) => b.v - a.v)
  const total = parts.reduce((a, p) => a + p.v, 0)
  const R = Math.min(height, 260) / 2 - 4
  let a0 = -Math.PI / 2
  const arc = p => {
    const a1 = a0 + (2 * Math.PI * p.v) / total
    const big = a1 - a0 > Math.PI ? 1 : 0
    const pt = a => `${R + R * Math.cos(a)} ${R + R * Math.sin(a)}`
    const d = parts.length === 1 ? `M ${R} 0 A ${R} ${R} 0 1 1 ${R - 0.01} 0 Z`
      : `M ${R} ${R} L ${pt(a0)} A ${R} ${R} 0 ${big} 1 ${pt(a1)} Z`
    a0 = a1
    return d
  }
  return (
    <div className="dash-chart dash-pie" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${2 * R} ${2 * R}`} width={2 * R} height={2 * R} role="img" aria-label="Круговая диаграмма">
        {parts.map(p => <path key={p.x} d={arc(p)} fill={p.c} stroke="#fff" strokeWidth={2}
          onMouseMove={e => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, p })} />)}
      </svg>
      {tip && <div className="dash-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
        <strong>{tip.p.x}</strong><span>{show(tip.p.v)} · {Math.round((100 * tip.p.v) / total)}%</span></div>}
      <ul className="dash-legend vertical">
        {parts.map(p => <li key={p.x}><i style={{ background: p.c }} />{p.x}<b>{show(p.v)}</b></li>)}
      </ul>
    </div>
  )
}
