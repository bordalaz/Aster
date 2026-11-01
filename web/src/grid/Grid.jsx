import { useCallback, useEffect, useMemo, useState } from 'react'
import { CompactSelection, DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel } from '@tanstack/react-table'
import '@glideapps/glide-data-grid/dist/index.css'
import { displayValue, isLink, kindOf, toCell, fromCell } from './cells.js'
import { columnTotal, groupRows, parsePastedBool, parsePastedNumber, toCSV } from './layout.js'
import { applyFilters, groupCols, visibleColumns } from './viewConfig.js'
import { renderers } from './renderers.js'
import { fieldIcon, headerIcons } from '../ui/icons.jsx'

function plural(n) {
  const a = n % 10, b = n % 100
  if (a === 1 && b !== 11) return 'запись'
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'записи'
  return 'записей'
}

// Тема сетки — значения сняты с веб-клиента Airtable.
const THEME = {
  accentColor: '#166ee1', accentLight: 'rgba(22, 110, 225, 0.08)',
  textDark: '#1d1f25', textMedium: '#616670', textLight: '#a0a4ab', textBubble: '#1d1f25',
  bgIconHeader: '#ffffff', fgIconHeader: '#616670', textHeader: '#1d1f25', textHeaderSelected: '#ffffff',
  bgCell: '#ffffff', bgCellMedium: '#f8f9fb', bgHeader: '#ffffff', bgHeaderHasFocus: '#f1f5ff', bgHeaderHovered: '#f7f8fa',
  bgBubble: '#e9eef6', bgBubbleSelected: '#ffffff', bgSearchResult: '#fff3c4',
  borderColor: '#e1e3e8', horizontalBorderColor: '#e1e3e8', drilldownBorder: 'rgba(0, 0, 0, 0)',
  linkColor: '#166ee1', cellHorizontalPadding: 8, cellVerticalPadding: 4,
  headerFontStyle: '500 13px', baseFontStyle: '13px', markerFontStyle: '11px',
  fontFamily: '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  editorFontSize: '13px', lineHeight: 1.4, headerIconSize: 16,
}
const ROW_H = 32, GROUP_H = 44, NUMERIC = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'autoNumber'])

// Сетка управляется конфигом вида: колонки и их порядок, ширины, сортировка, фильтры (R9, R10).
// Без onConfigChange (тесты, простые места) держит конфиг сама. search — поиск из панели вида.
export default function Grid({ fields, rows, primaryField, title = 'таблица', config: outer, onConfigChange, onEdit, onEditMany, onOpen,
  search = '', exportRef }) {
  const [inner, setInner] = useState({})
  const config = outer ?? inner
  const setConfig = onConfigChange ?? setInner
  const patchConfig = useCallback(p => setConfig({ ...config, ...p }), [config, setConfig])

  // Первичное поле — первой колонкой и закреплено слева (R9).
  const cols = useMemo(() => visibleColumns(fields, primaryField, config.columns), [fields, primaryField, config.columns])
  const widths = config.widths ?? {}
  const sorting = useMemo(() => (config.sort ?? []).map(s => ({ id: s.col, desc: s.desc })), [config.sort])
  const data = useMemo(() => applyFilters(fields, rows, config.filters), [fields, rows, config.filters])

  const table = useReactTable({
    data,
    // связи — [{id, name}]: сортировка и поиск по названиям
    columns: useMemo(() => cols.map(c => (isLink(c)
      ? { id: c.column_name, accessorFn: r => (r[c.column_name]?.length ? displayValue(c, r[c.column_name]) : '') }
      : { accessorKey: c.column_name })), [cols]),
    state: { sorting, globalFilter: search },
    enableMultiSort: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: r => String(r.id),
  })
  const view = table.getRowModel().rows
  const shownRows = useMemo(() => view.map(r => r.original), [view])

  // Группировка (R9) и строка итогов, закреплённая внизу.
  const groupFields = useMemo(() => groupCols(config.group).map(c => fields.find(f => f.column_name === c)).filter(Boolean),
    [config.group, fields])
  const [collapsed, setCollapsed] = useState(new Set())
  const items = useMemo(() => groupRows(shownRows, groupFields, collapsed), [shownRows, groupFields, collapsed])
  // Итоги как у Airtable по умолчанию: суммы только у числовых полей, остальное пусто; слева — число записей.
  const totals = useMemo(() => cols.map((c, i) => (i === 0 ? `${view.length} ${plural(view.length)}`
    : NUMERIC.has(kindOf(c)) ? columnTotal(c, shownRows) : '')), [cols, shownRows, view.length])
  const toggleGroup = key => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const exportCSV = useCallback(() => {
    const blob = new Blob([toCSV(cols, shownRows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [cols, shownRows, title])
  useEffect(() => { if (exportRef) exportRef.current = exportCSV }, [exportRef, exportCSV])

  // Колонка 0 — номера записей (как в Airtable: группы не нумеруются); щелчок по номеру открывает карточку.
  const gridColumns = useMemo(() => [{ id: '__n', title: '', width: 52 }, ...cols.map(c => ({
    id: c.column_name, title: c.title, icon: `i-${fieldIcon(c.kind)}`,
    width: widths[c.column_name] ?? (c.column_name === primaryField ? 260 : 160),
  }))], [cols, widths, primaryField])
  const nums = useMemo(() => { let n = 0; return items.map(i => (i.kind === 'row' ? ++n : null)) }, [items])
  const fieldAt = ci => cols[ci - 1]

  const text = (t, bold) => ({ kind: GridCellKind.Text, data: t, displayData: t, allowOverlay: false, readonly: true,
    themeOverride: bold ? { baseFontStyle: '500 13px' } : undefined })
  const getCellContent = useCallback(([ci, ri]) => {
    if (ri === items.length) {                                         // строка итогов
      return ci <= 1 ? { ...text(totals[0], false), span: [0, 1] } : text(totals[ci - 1], false)
    }
    const it = items[ri]
    if (it.kind === 'group') {
      if (ci > 1) return text('', false)
      return { kind: GridCellKind.Custom, allowOverlay: false, readonly: true, copyData: it.key, span: [0, 1],
        data: { kind: 'group', label: groupFields[it.depth]?.title ?? '', value: String(it.key || '(пусто)'), count: it.count,
          collapsed: it.collapsed, depth: it.depth } }
    }
    if (ci === 0) return { ...text(String(nums[ri]), false), contentAlign: 'center', themeOverride: { baseFontStyle: '11px', textDark: '#a0a4ab' } }
    const field = fieldAt(ci)
    return toCell(field, it.row[field.column_name])
  }, [cols, items, totals, groupFields, nums])   // eslint-disable-line react-hooks/exhaustive-deps
  const rowAt = ri => (items[ri]?.kind === 'row' ? items[ri].row : null)

  const onCellEdited = useCallback(([ci, ri], cell) => {
    const field = fieldAt(ci), row = rowAt(ri)
    const v = field ? fromCell(field, cell) : undefined
    if (!field?.editable || !row || v === undefined) return   // undefined — нераспознанный ввод
    onEdit(row, field.column_name, v)
  }, [cols, items, onEdit])   // eslint-disable-line react-hooks/exhaustive-deps

  // Вставка из Excel (R9): несколько ячеек — одним пакетом; правимые поля, только строки данных.
  const onCellsEdited = useCallback(edits => {
    if (edits.length < 2 || !onEditMany) return false     // одна ячейка — обычный onCellEdited
    const byRow = new Map()
    for (const { location: [ci, ri], value } of edits) {
      const field = fieldAt(ci), row = rowAt(ri)
      const v = field?.editable && row ? fromCell(field, value) : undefined
      if (v === undefined) continue
      if (!byRow.has(row.id)) byRow.set(row.id, { row, values: {} })
      byRow.get(row.id).values[field.column_name] = v
    }
    if (byRow.size) onEditMany([...byRow.values()])
    return true
  }, [cols, items, onEditMany])   // eslint-disable-line react-hooks/exhaustive-deps

  const coercePasteValue = useCallback((val, cell) => {
    if (cell.kind === GridCellKind.Number) {
      const n = parsePastedNumber(val)
      return n === undefined ? cell : { ...cell, data: n ?? undefined }
    }
    if (cell.kind === GridCellKind.Custom && cell.data?.kind === 'check') return { ...cell, data: { ...cell.data, value: parsePastedBool(val) } }
    return undefined   // текст — как есть
  }, [])

  // Карточка открывается как в Airtable: щелчок по номеру записи или пробел на выделенной ячейке.
  const [selection, setSelection] = useState({ columns: CompactSelection.empty(), rows: CompactSelection.empty() })
  const onKeyDown = useCallback(e => {
    const cell = selection.current?.cell
    if (e.key === ' ' && cell && rowAt(cell[1])) { e.preventDefault(); onOpen(rowAt(cell[1]), shownRows.map(r => r.id)) }
  }, [selection, items, onOpen, shownRows])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--canvas)' }}>
      <span role="status" className="sr-only">{view.length} {plural(view.length)}</span>
      <span data-testid="col-order" style={{ display: 'none' }}>{cols.map(c => c.column_name).join(',')}</span>
      <span data-testid="grid-items" style={{ display: 'none' }}>{items.map(i => (i.kind === 'group' ? `[${i.key}]` : i.row.id)).join(',')}</span>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataEditor
          theme={THEME}
          headerIcons={headerIcons}
          customRenderers={renderers}
          columns={gridColumns}
          rows={items.length + 1}
          rowHeight={ri => (items[ri]?.kind === 'group' ? GROUP_H : ROW_H)}
          headerHeight={32}
          freezeTrailingRows={1}
          getCellContent={getCellContent}
          getRowThemeOverride={ri => (ri === items.length ? { bgCell: '#ffffff', textDark: '#616670' } : undefined)}
          onCellEdited={onCellEdited}
          onCellsEdited={onCellsEdited}
          coercePasteValue={coercePasteValue}
          onPaste   // диапазон из Excel раскладывается по ячейкам (без флага Glide кладёт всё в одну)
          onCellClicked={([ci, ri]) => {
            if (ci <= 1 && items[ri]?.kind === 'group') toggleGroup(items[ri].id)
            else if (ci === 0 && rowAt(ri)) onOpen(rowAt(ri), shownRows.map(r => r.id))
          }}
          gridSelection={selection}
          onGridSelectionChange={setSelection}
          onKeyDown={onKeyDown}
          onColumnResize={(col, w) => col.id !== '__n' && patchConfig({ widths: { ...widths, [col.id]: Math.round(Math.min(2000, Math.max(40, w))) } })}
          onColumnMoved={(from, to) => {
            if (from <= 1 || to <= 1) return   // номера и первичное поле остаются слева
            const names = cols.map(c => c.column_name)
            const [moved] = names.splice(from - 1, 1)
            names.splice(to - 1, 0, moved)
            patchConfig({ columns: names.filter(n => n !== primaryField) })
          }}
          rowMarkers="none"
          freezeColumns={2}
          width="100%"
          height="100%"
          smoothScrollY
          smoothScrollX
          getCellsForSelection
        />
      </div>
    </div>
  )
}
