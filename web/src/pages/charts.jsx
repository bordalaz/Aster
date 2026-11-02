import { useLayoutEffect, useRef, useState } from 'react'
import { choiceColor, HUE_SHADES } from '../grid/renderers.js'
import { kindOf, numText } from '../grid/cells.js'

// Палитры графиков Airtable (схемы из его веб-клиента; tableauExtended рисуется палитрой vega tableau20).
// Серия i — scheme[i % n], одиночная серия — scheme[primary]; fieldColors — цвета вариантов поля.
export const SCHEMES = {
  airtable: ['#46bfdd', '#fac235', '#ec4f76', '#4787cd', '#6ec764', '#ad7fe1'],
  skyTones: ['#364da3', '#4485b2', '#3dbfbf', '#ffbcaf', '#f4777f', '#cf3759'],
  morningDew: ['#364a5f', '#296a75', '#27897d', '#4ea777', '#aacc11', '#d3d55c'],
  cityLights: ['#003f5c', '#444e86', '#955196', '#dd5182', '#ff6e54', '#ffa600'],
  category: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
  categoryExtended: ['#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a', '#d62728', '#ff9896', '#9467bd',
    '#c5b0d5', '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d', '#17becf', '#9edae5'],
  tableau: ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'],
  tableauExtended: ['#4c78a8', '#9ecae9', '#f58518', '#ffbf79', '#54a24b', '#88d27a', '#b79a20', '#f2cf5b', '#439894',
    '#83bcb6', '#e45756', '#ff9d98', '#79706e', '#bab0ac', '#d67195', '#fcbfd2', '#b279a2', '#d6a5c9', '#9e765f', '#d8b5a5'],
}

export function colorsFor(names, field, colors = {}) {
  const scheme = SCHEMES[colors.scheme] ?? SCHEMES.airtable
  if (names.length === 1 && names[0] == null) return [scheme[(colors.primary ?? 3) % scheme.length]]
  const choice = Object.fromEntries(choicesOf(field).map(c => [c.name, c.color]))
  return names.map((g, i) => (colors.field && choice[g] ? choiceColor(choice[g]).bg : scheme[i % scheme.length]))
}

const choicesOf = f => f?.options?.choices ?? f?.options?.result?.options?.choices ?? []
const optsOf = f => (f?.options?.result ? f.options.result.options : f?.options) ?? {}

// Числа как в Airtable: формат поля (точность), у денежных — разделитель тысяч «,» и символ; счётчики — «2 301».
export function fmt(field, n, agg) {
  if (n == null) return '—'
  if (agg === 'count' || agg === 'unique' || agg === 'filled' || !field) return n.toLocaleString('ru-RU')
  const t = numText(field, n)
  if (kindOf(field) !== 'currency' || !/^-?\d+(\.\d+)?$/.test(t)) return t
  const [i, d] = t.replace('-', '').split('.')
  return `${t.startsWith('-') ? '-' : ''}${optsOf(field).symbol ?? ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d ? '.' + d : ''}`
}

const TILE = { lightBlue: 'blue', lightGreen: 'green', lightYellow: 'yellow', lightPink: 'pink', lightRed: 'red',
  lightPurple: 'purple', lightTeal: 'teal', lightCyan: 'cyan', lightOrange: 'orange', textGray: 'gray' }

export function Tile({ label, value, color }) {
  const hue = HUE_SHADES[TILE[color] ?? 'gray']
  return (
    <div className={color === 'textGray' ? 'dash-tile plain' : 'dash-tile'} style={color === 'textGray' ? undefined : { background: hue[0] }}>
      <div className="dash-tile-label">{label}</div>
      <div className="dash-tile-num">{value}</div>
    </div>
  )
}

// Легенда справа, как в Airtable: название поля и значения столбиком, длинная — прокручивается.
function Legend({ title, names, colors, height }) {
  if (!names.length || names[0] == null) return null
  return (
    <div className="dash-legend" style={{ maxHeight: height }}>
      {title && <div className="dash-legend-title">{title}</div>}
      <ul>{names.map((g, i) => <li key={g} title={g}><i style={{ background: colors[i] }} /><span>{g}</span></li>)}</ul>
    </div>
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

// Шкала как в Airtable (d3 nice): ~6 делений с шагом 1/2/5·10ᵏ, верх — ближайшее деление над максимумом.
export function niceTicks(m) {
  if (!(m > 0)) return [0, 1]
  const raw = m / 6, p = 10 ** Math.floor(Math.log10(raw)), r = raw / p
  const step = (r >= Math.sqrt(50) ? 10 : r >= Math.sqrt(10) ? 5 : r >= Math.sqrt(2) ? 2 : 1) * p   // пороги d3
  return Array.from({ length: Math.ceil(m / step - 1e-9) + 1 }, (_, i) => i * step)
}

// Ширина контейнера: SVG рисуется в настоящих пикселях, шрифты не растягиваются вместе с графиком.
function useWidth(fallback) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, w]
}

// Столбцы со стопкой по группе, как в Airtable: подписи X под 45°, легенда справа.
export function BarChart({ s, colors, show, height, legendTitle }) {
  const [tip, setTip] = useState(null)
  const [ref, W] = useWidth(640)
  const H = height, T = 8
  const totals = s.xs.map(x => s.groups.reduce((a, g) => a + s.value(x, g), 0))
  const ticks = niceTicks(Math.max(0, ...totals))
  const max = ticks[ticks.length - 1]
  const L = Math.max(...ticks.map(t => show(t).length)) * 6.5 + 14   // подписи оси Y целиком
  const B = Math.min(70, Math.max(...s.xs.map(x => String(x).length)) * 5 + 16)   // под наклонные подписи X
  const step = (W - L) / Math.max(1, s.xs.length)
  const bw = Math.min(48, step * 0.6)
  const y = v => T + (H - T - B) * (1 - v / max)
  const every = Math.ceil(s.xs.length / Math.max(1, Math.floor((W - L) / 22)))   // наклонные подписи не налезают
  return (
    <div className="dash-chart" onMouseLeave={() => setTip(null)}>
      <div className="dash-plot">
        <div ref={ref} className="dash-svg">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Столбчатая диаграмма">
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
                    return <rect key={g} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)}
                      fill={colors[gi]} onMouseMove={e => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, x0: x, g, v })} />
                  })}
                  {i % every === 0 && <text transform={`translate(${cx},${H - B + 10}) rotate(-45)`} textAnchor="end"
                    className="dash-axis">{x}</text>}
                </g>
              )
            })}
          </svg>
          {tip && <div className="dash-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
            <strong>{tip.x0}</strong>{tip.g != null && <span>{tip.g}</span>}<span>{show(tip.v)}</span></div>}
        </div>
        <Legend title={legendTitle} names={s.groups} colors={colors} height={H} />
      </div>
      <DataTable xs={s.xs} groups={s.groups} value={s.value} show={show} />
    </div>
  )
}

// Круговая, как в Airtable: срезы в порядке легенды по часовой от 12 часов, доли — на срезах, легенда справа.
export function PieChart({ s, colorsOf, show, height, legendTitle }) {
  const [tip, setTip] = useState(null)
  const names = s.xs.filter(x => s.value(x, null) > 0)
  const cs = colorsOf(names)
  const parts = names.map((x, i) => ({ x, v: s.value(x, null), c: cs[i] }))
  const total = parts.reduce((a, p) => a + p.v, 0)
  const R = Math.min(height, 300) / 2 - 4
  const pct = v => `${((100 * v) / total).toFixed(1)}%`
  let a0 = -Math.PI / 2
  const slices = parts.map(p => {
    const a1 = a0 + (2 * Math.PI * p.v) / total
    const pt = (a, r = R) => `${R + r * Math.cos(a)} ${R + r * Math.sin(a)}`
    const d = parts.length === 1 ? `M ${R} 0 A ${R} ${R} 0 1 1 ${R - 0.01} 0 Z`
      : `M ${R} ${R} L ${pt(a0)} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)} Z`
    const mid = (a0 + a1) / 2
    const out = { ...p, d, lx: R + R * 0.7 * Math.cos(mid), ly: R + R * 0.7 * Math.sin(mid), big: a1 - a0 > 0.25 }
    a0 = a1
    return out
  })
  return (
    <div className="dash-chart" onMouseLeave={() => setTip(null)}>
      <div className="dash-plot dash-pie">
        <div className="dash-svg">
          <svg viewBox={`0 0 ${2 * R} ${2 * R}`} width={2 * R} height={2 * R} role="img" aria-label="Круговая диаграмма">
            {slices.map(p => <path key={p.x} d={p.d} fill={p.c} stroke="#fff" strokeWidth={1}
              onMouseMove={e => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, p })} />)}
            {slices.filter(p => p.big).map(p => <text key={p.x} x={p.lx} y={p.ly + 4} textAnchor="middle" className="dash-pct">{pct(p.v)}</text>)}
          </svg>
          {tip && <div className="dash-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
            <strong>{tip.p.x}</strong><span>{show(tip.p.v)} · {pct(tip.p.v)}</span></div>}
        </div>
        <Legend title={legendTitle} names={parts.map(p => p.x)} colors={parts.map(p => p.c)} height={2 * R} />
      </div>
      <DataTable xs={parts.map(p => p.x)} groups={[null]} value={x => s.value(x, null)} show={show} />
    </div>
  )
}
