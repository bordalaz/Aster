import { useCallback, useMemo, useState } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel } from '@tanstack/react-table'
import '@glideapps/glide-data-grid/dist/index.css'
import { displayValue, isLink, toCell, fromCell } from './cells.js'
import { columnTotal, groupRows, parsePastedBool, parsePastedNumber, toCSV } from './layout.js'
import { applyFilters, groupCols, visibleColumns } from './viewConfig.js'

function plural(n) {
  const a = n % 10, b = n % 100
  if (a === 1 && b !== 11) return 'запись'
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'записи'
  return 'записей'
}

// Сетка управляется конфигом вида: колонки и их порядок, ширины, сортировка, фильтры (R9, R10).
// Без onConfigChange (тесты, простые места) держит конфиг сама.
export default function Grid({ fields, rows, primaryField, title = 'таблица', config: outer, onConfigChange, onEdit, onEditMany, onOpen }) {
  const [inner, setInner] = useState({})
  const config = outer ?? inner
  const setConfig = onConfigChange ?? setInner
  const patchConfig = useCallback(p => setConfig({ ...config, ...p }), [config, setConfig])

  // Первичное поле — первой колонкой и закреплено слева (R9).
  const cols = useMemo(() => visibleColumns(fields, primaryField, config.columns), [fields, primaryField, config.columns])
  const widths = config.widths ?? {}
  const sorting = useMemo(() => (config.sort ?? []).map(s => ({ id: s.col, desc: s.desc })), [config.sort])
  const data = useMemo(() => applyFilters(fields, rows, config.filters), [fields, rows, config.filters])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data,
    // связи — [{id, name}]: сортировка и поиск по названиям
    columns: useMemo(() => cols.map(c => (isLink(c)
      ? { id: c.column_name, accessorFn: r => (r[c.column_name]?.length ? displayValue(c, r[c.column_name]) : '') }
      : { accessorKey: c.column_name })), [cols]),
    state: { sorting, globalFilter },
    onSortingChange: up => {
      const next = typeof up === 'function' ? up(sorting) : up
      patchConfig({ sort: next.map(s => ({ col: s.id, desc: s.desc })) })
    },
    onGlobalFilterChange: setGlobalFilter,
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
  const totals = useMemo(() => cols.map(c => columnTotal(c, shownRows)), [cols, shownRows])
  const toggleGroup = key => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  function exportCSV() {
    const blob = new Blob([toCSV(cols, shownRows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const gridColumns = useMemo(() => cols.map(c => {
    const s = sorting.find(x => x.id === c.column_name)
    return { id: c.column_name, title: c.title + (s ? (s.desc ? ' ▼' : ' ▲') : ''), width: widths[c.column_name] ?? 160 }
  }), [cols, widths, sorting])

  const text = (t, bold) => ({ kind: GridCellKind.Text, data: t, displayData: t, allowOverlay: false, readonly: true,
    themeOverride: bold ? { baseFontStyle: '600 13px' } : undefined })
  const getCellContent = useCallback(([ci, ri]) => {
    if (ri === items.length) return text(totals[ci], true)          // строка итогов
    const it = items[ri]
    if (it.kind === 'group') return text(ci === 0 ? `${'    '.repeat(it.depth)}${it.collapsed ? '▸' : '▾'} ${it.key} · ${it.count}` : '', true)
    const field = cols[ci]
    return toCell(field, it.row[field.column_name])
  }, [cols, items, totals])
  const rowAt = ri => (items[ri]?.kind === 'row' ? items[ri].row : null)

  const onCellEdited = useCallback(([ci, ri], cell) => {
    const field = cols[ci], row = rowAt(ri)
    if (!field.editable || !row) return
    onEdit(row, field.column_name, fromCell(field, cell))
  }, [cols, items, onEdit])   // eslint-disable-line react-hooks/exhaustive-deps

  // Вставка из Excel (R9): несколько ячеек — одним пакетом; правимые поля, только строки данных.
  const onCellsEdited = useCallback(edits => {
    if (edits.length < 2 || !onEditMany) return false     // одна ячейка — обычный onCellEdited
    const byRow = new Map()
    for (const { location: [ci, ri], value } of edits) {
      const field = cols[ci], row = rowAt(ri)
      if (!field?.editable || !row) continue
      if (!byRow.has(row.id)) byRow.set(row.id, { row, values: {} })
      byRow.get(row.id).values[field.column_name] = fromCell(field, value)
    }
    if (byRow.size) onEditMany([...byRow.values()])
    return true
  }, [cols, items, onEditMany])   // eslint-disable-line react-hooks/exhaustive-deps

  const coercePasteValue = useCallback((val, cell) => {
    if (cell.kind === GridCellKind.Number) {
      const n = parsePastedNumber(val)
      return n === undefined ? cell : { ...cell, data: n ?? undefined }
    }
    if (cell.kind === GridCellKind.Boolean) return { ...cell, data: parsePastedBool(val) }
    return undefined   // текст — как есть
  }, [])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid var(--line)' }}>
        <input className="search" placeholder="Поиск" value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} />
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{view.length} {plural(view.length)}</span>
        <button className="btn" onClick={exportCSV} title="CSV для Excel: видимые колонки и строки текущего вида">Выгрузить CSV</button>
      </div>
      <span data-testid="col-order" style={{ display: 'none' }}>{cols.map(c => c.column_name).join(',')}</span>
      <span data-testid="grid-items" style={{ display: 'none' }}>{items.map(i => (i.kind === 'group' ? `[${i.key}]` : i.row.id)).join(',')}</span>
      <div style={{ flex: 1 }}>
        <DataEditor
          columns={gridColumns}
          rows={items.length + 1}
          freezeTrailingRows={1}
          getCellContent={getCellContent}
          getRowThemeOverride={ri => (ri === items.length || items[ri]?.kind === 'group' ? { bgCell: '#F3F4F8' } : undefined)}
          onCellEdited={onCellEdited}
          onCellsEdited={onCellsEdited}
          coercePasteValue={coercePasteValue}
          onPaste   // диапазон из Excel раскладывается по ячейкам (без флага Glide кладёт всё в одну)
          onCellClicked={([, ri]) => {
            const it = items[ri]
            if (it?.kind === 'group') toggleGroup(it.id)
            else if (it?.kind === 'row') onOpen(it.row)
          }}
          onHeaderClicked={ci => table.getColumn(cols[ci].column_name).toggleSorting()}
          onColumnResize={(col, w) => patchConfig({ widths: { ...widths, [col.id]: Math.round(Math.min(2000, Math.max(40, w))) } })}
          onColumnMoved={(from, to) => {
            if (from === 0 || to === 0) return   // первичное поле остаётся первым
            const names = cols.map(c => c.column_name)
            const [moved] = names.splice(from, 1)
            names.splice(to, 0, moved)
            patchConfig({ columns: names.filter(n => n !== primaryField) })
          }}
          rowMarkers="number"
          freezeColumns={1}
          width="100%"
          height="100%"
          smoothScrollY
          getCellsForSelection
        />
      </div>
    </div>
  )
}
