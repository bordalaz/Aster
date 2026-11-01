import { GridCellKind } from '@glideapps/glide-data-grid'

// Палитра Airtable по имени цвета варианта (options.choices[].color).
const HUES = {
  blue: ['#cfdfff', '#9cc7ff', '#2d7ff9', '#2750ae'], cyan: ['#d0f0fd', '#77d1f3', '#18bfff', '#0b76b7'],
  teal: ['#c2f5e9', '#72ddc3', '#20d9d2', '#06a09b'], green: ['#d1f7c4', '#93e088', '#20c933', '#338a17'],
  yellow: ['#ffeab6', '#ffd66e', '#fcb400', '#b87503'], orange: ['#fee2d5', '#ffa981', '#ff6f2c', '#d74d26'],
  red: ['#ffdce5', '#ff9eb7', '#f82b60', '#ba1e45'], pink: ['#ffdaf6', '#f99de2', '#ff08c2', '#b2158b'],
  purple: ['#ede2fe', '#cdb0ff', '#8b46ff', '#6b1cb0'], gray: ['#eeeeee', '#cccccc', '#666666', '#444444'],
}
const SHADE = { Light2: 0, Light1: 1, Bright: 2, Dark1: 3 }
export function choiceColor(name) {
  const m = /^([a-z]+)(Light2|Light1|Bright|Dark1)$/.exec(name ?? '')
  if (!m || !HUES[m[1]]) return { bg: '#eeeeee', fg: '#1d1f25' }
  const shade = SHADE[m[2]]
  return { bg: HUES[m[1]][shade], fg: shade >= 2 && m[1] !== 'yellow' ? '#ffffff' : '#1d1f25' }
}
export const LINK_PILL = { bg: '#e9eef6', fg: '#1d1f25' }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// Плашки: выбор (круглые, цветные) и связи (скруглённые, серо-голубые).
const pills = {
  kind: GridCellKind.Custom,
  isMatch: c => c.data?.kind === 'pills',
  draw: ({ ctx, rect, theme }, cell) => {
    const { items, round } = cell.data
    ctx.save()
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip()
    ctx.font = `12px ${theme.fontFamily}`
    ctx.textBaseline = 'middle'
    const h = 20, y = rect.y + (rect.height - h) / 2
    let x = rect.x + theme.cellHorizontalPadding
    for (const it of items) {
      if (x > rect.x + rect.width) break
      const w = Math.ceil(ctx.measureText(it.text).width) + 16
      ctx.fillStyle = it.bg
      roundRect(ctx, x, y, w, h, round ? h / 2 : 4); ctx.fill()
      ctx.fillStyle = it.fg
      ctx.fillText(it.text, x + 8, y + h / 2 + 1)
      x += w + 4
    }
    ctx.restore()
    return true
  },
}

// Галочка как в Airtable: цветная ✓ без рамки; пусто — ничего. Клик переключает.
const check = {
  kind: GridCellKind.Custom,
  isMatch: c => c.data?.kind === 'check',
  draw: ({ ctx, rect }, cell) => {
    if (!cell.data.value) return true
    const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
    ctx.save()
    ctx.strokeStyle = cell.data.color; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx - 2, cy + 4); ctx.lineTo(cx + 6, cy - 5); ctx.stroke()
    ctx.restore()
    return true
  },
  onClick: ({ cell }) => (cell.readonly ? undefined : { ...cell, data: { ...cell.data, value: !cell.data.value } }),
}

// Обрезать текст с «…» под ширину.
function fit(ctx, text, w) {
  if (ctx.measureText(text).width <= w) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1)
  return t + '…'
}

// Заголовок группы: стрелка, подпись поля мелко сверху, значение жирно, число записей справа.
const group = {
  kind: GridCellKind.Custom,
  isMatch: c => c.data?.kind === 'group',
  draw: ({ ctx, rect, theme }, cell) => {
    const { label, value, count, collapsed, depth } = cell.data
    ctx.save()
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip()
    const x0 = rect.x + 12 + depth * 16, cy = rect.y + rect.height / 2
    ctx.strokeStyle = '#616670'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath()
    if (collapsed) { ctx.moveTo(x0, cy - 4); ctx.lineTo(x0 + 4, cy); ctx.lineTo(x0, cy + 4) }
    else { ctx.moveTo(x0 - 2, cy - 2); ctx.lineTo(x0 + 2, cy + 2); ctx.lineTo(x0 + 6, cy - 2) }
    ctx.stroke()
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#616670'; ctx.font = `500 10px ${theme.fontFamily}`
    ctx.fillText(label.toUpperCase(), x0 + 16, cy - 4)
    ctx.font = `13px ${theme.fontFamily}`
    const countW = ctx.measureText(String(count)).width
    ctx.fillStyle = '#1d1f25'; ctx.font = `600 13px ${theme.fontFamily}`
    ctx.fillText(fit(ctx, value, rect.x + rect.width - 24 - countW - (x0 + 16)), x0 + 16, cy + 12)
    ctx.fillStyle = '#616670'; ctx.font = `13px ${theme.fontFamily}`; ctx.textAlign = 'right'
    ctx.fillText(String(count), rect.x + rect.width - 12, cy + 5)
    ctx.restore()
    return true
  },
}

export const renderers = [pills, check, group]
