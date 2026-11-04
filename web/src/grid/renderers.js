import { GridCellKind } from '@glideapps/glide-data-grid'
import SelectEditor from './SelectEditor.jsx'
import LinkEditor from '../links/LinkEditor.jsx'
import { GridDateEditor } from '../ui/DatePicker.jsx'
import { parseDateText } from './cells.js'

// Палитра Airtable по имени цвета варианта (options.choices[].color).
const HUES = {
  blue: ['#cfdfff', '#9cc7ff', '#2d7ff9', '#2750ae'], cyan: ['#d0f0fd', '#77d1f3', '#18bfff', '#0b76b7'],
  teal: ['#c2f5e9', '#72ddc3', '#20d9d2', '#06a09b'], green: ['#d1f7c4', '#93e088', '#20c933', '#338a17'],
  yellow: ['#ffeab6', '#ffd66e', '#fcb400', '#b87503'], orange: ['#fee2d5', '#ffa981', '#ff6f2c', '#d74d26'],
  red: ['#ffdce5', '#ff9eb7', '#f82b60', '#ba1e45'], pink: ['#ffdaf6', '#f99de2', '#ff08c2', '#b2158b'],
  purple: ['#ede2fe', '#cdb0ff', '#8b46ff', '#6b1cb0'], gray: ['#eeeeee', '#cccccc', '#666666', '#444444'],
}
export const HUE_SHADES = HUES
const SHADE = { Light2: 0, Light1: 1, Bright: 2, Dark1: 3 }
export function choiceColor(name) {
  const m = /^([a-z]+)(Light2|Light1|Bright|Dark1)$/.exec(name ?? '')
  if (!m || !HUES[m[1]]) return { bg: '#eeeeee', fg: '#1d1f25' }
  const shade = SHADE[m[2]]
  return { bg: HUES[m[1]][shade], fg: shade >= 2 && m[1] !== 'yellow' ? '#ffffff' : '#1d1f25' }
}
// Цвет кнопки по варианту Airtable: solid* — насыщенный, light* — светлый, text* — только текст.
export function buttonStyle(variant) {
  const m = /^(solid|light|text)([A-Z][a-z]+)$/.exec(variant ?? '')
  const hue = m && HUE_SHADES[m[2].toLowerCase()]
  if (!hue) return { background: '#eeeeee', color: '#1d1f25' }
  if (m[1] === 'solid') return { background: hue[2], color: m[2] === 'Yellow' ? '#1d1f25' : '#fff' }
  if (m[1] === 'light') return { background: hue[0], color: '#1d1f25' }
  return { background: 'transparent', color: hue[3] }
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
  // свои поля выбора: список вариантов поверх ячейки
  provideEditor: c => (c.data.choices ? { editor: SelectEditor, disablePadding: true, disableStyling: true }
    : c.data.link ? { editor: LinkEditor, disablePadding: true, disableStyling: true } : undefined),
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

// Ячейка номера, как в Airtable (rowActionsCell): при наведении на строку — ручка ⋮⋮ (перетаскивание,
// только без сортировки), галочка выбора вместо номера и кнопка раскрытия у названия; у правого края —
// цветная полоса строки (colorConfig вида). Отмеченная строка держит галочку и без наведения.
export const ROWNUM_W = 72
const DRAG_W = 14, CHECK_X = 14, CHECK_W = 22, EXPAND_X = 38, EXPAND_W = 24
// Что под курсором в ячейке номера (localX — от левого края ячейки); ручка — только если строки можно двигать.
export function rownumHit(localX, { drag = false } = {}) {
  if (drag && localX < DRAG_W) return 'drag'
  if (localX >= CHECK_X && localX < CHECK_X + CHECK_W) return 'check'
  if (localX >= EXPAND_X && localX < EXPAND_X + EXPAND_W) return 'expand'
  return 'number'
}

function expandIcon(ctx, x, y) {   // две стрелки наружу по диагонали (arrows-out-simple), 16×16
  ctx.strokeStyle = '#616670'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x + 9.5, y + 6.5); ctx.lineTo(x + 13, y + 3)
  ctx.moveTo(x + 9, y + 3); ctx.lineTo(x + 13, y + 3); ctx.lineTo(x + 13, y + 7)
  ctx.moveTo(x + 6.5, y + 9.5); ctx.lineTo(x + 3, y + 13)
  ctx.moveTo(x + 3, y + 9); ctx.lineTo(x + 3, y + 13); ctx.lineTo(x + 7, y + 13)
  ctx.stroke()
}

function checkbox(ctx, x, y, on) {   // 14×14, как галочка строки Airtable
  ctx.lineWidth = 1
  roundRect(ctx, x + 0.5, y + 0.5, 13, 13, 3)
  if (on) { ctx.fillStyle = '#166ee1'; ctx.fill() } else { ctx.strokeStyle = '#a0a4ab'; ctx.stroke() }
  if (on) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.75; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(x + 3.5, y + 7.2); ctx.lineTo(x + 6, y + 9.6); ctx.lineTo(x + 10.5, y + 4.4); ctx.stroke()
  }
}

function grip(ctx, x, y) {   // ⋮⋮ — ручка перетаскивания
  ctx.fillStyle = '#a0a4ab'
  for (const dx of [0, 4]) for (const dy of [0, 4, 8]) { ctx.beginPath(); ctx.arc(x + dx + 1, y + dy + 1, 1, 0, Math.PI * 2); ctx.fill() }
}

const rownum = {
  kind: GridCellKind.Custom,
  isMatch: c => c.data?.kind === 'rownum',
  draw: ({ ctx, rect, theme }, cell) => {
    const { n, hover, checked, drag, color } = cell.data
    const mid = rect.y + Math.min(rect.height, 32) / 2
    ctx.save()
    if (hover && drag) grip(ctx, rect.x + 4, mid - 5)
    if (hover || checked) checkbox(ctx, rect.x + CHECK_X + (CHECK_W - 14) / 2, mid - 7, checked)
    else {
      ctx.fillStyle = '#a0a4ab'; ctx.font = `11px ${theme.fontFamily}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(n, rect.x + CHECK_X + CHECK_W / 2, mid)
    }
    if (hover) expandIcon(ctx, rect.x + EXPAND_X + (EXPAND_W - 16) / 2, mid - 8)
    if (color) {
      ctx.fillStyle = color
      roundRect(ctx, rect.x + rect.width - 7, rect.y + 4, 4, rect.height - 8, 2); ctx.fill()
    }
    ctx.restore()
    return true
  },
}

// Дата/время, которые можно править: текст в формате поля, редактор — календарь (как в Airtable).
const date = {
  kind: GridCellKind.Custom,
  isMatch: c => c.data?.kind === 'date',
  draw: ({ ctx, rect, theme }, cell) => {
    ctx.save()
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`; ctx.fillStyle = theme.textDark; ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, cell.data.text, rect.width - 2 * theme.cellHorizontalPadding), rect.x + theme.cellHorizontalPadding, rect.y + rect.height / 2)
    ctx.restore()
    return true
  },
  provideEditor: () => ({ editor: GridDateEditor, disablePadding: true, disableStyling: true }),
  onPaste: (text, data) => {   // вставка из Excel: «23.3.2018», «2018-03-23 20:30»
    const v = parseDateText(data.field, text)
    return v === undefined ? undefined : { ...data, value: v }
  },
}

// Поле-кнопка: скруглённая кнопка с подписью цвета варианта (как в Airtable); щелчок — в Grid.onCellClicked.
const btn = {
  kind: GridCellKind.Custom,
  isMatch: c => c.data?.kind === 'btn',
  draw: ({ ctx, rect, theme }, cell) => {
    const { label, bg, fg, off } = cell.data
    ctx.save()
    ctx.font = `500 12px ${theme.fontFamily}`
    const w = Math.min(rect.width - 16, ctx.measureText(label).width + 20), h = 22
    const x = rect.x + 8, y = rect.y + (rect.height - h) / 2
    ctx.globalAlpha = off ? 0.5 : 1
    if (bg !== 'transparent') { ctx.fillStyle = bg; roundRect(ctx, x, y, w, h, 4); ctx.fill() }
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, label, w - 20), x + 10, y + h / 2)
    ctx.restore()
    return true
  },
}

export const renderers = [pills, check, group, rownum, date, btn]
