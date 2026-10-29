import React, { useCallback, useMemo, useState } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getGroupedRowModel, getExpandedRowModel,
} from '@tanstack/react-table'
import '@glideapps/glide-data-grid/dist/index.css'

// Логика строк (поиск/сортировка/группировка) — TanStack без отрисовки, отрисовка — Glide
export default function GlideGrid({ rows, cols, update }) {
  const [widths, setWidths] = useState(() => Object.fromEntries(cols.map(c => [c.id, c.width])))
  const [sorting, setSorting] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [grouping, setGrouping] = useState([])
  const [expanded, setExpanded] = useState({})
  const data = useMemo(() => rows.map((r, i) => ({ ...r, _i: i })), [rows])
  const columns = useMemo(() => cols.map(c => ({ accessorKey: c.id })), [cols])
  const table = useReactTable({
    data, columns, state: { sorting, globalFilter, grouping, expanded },
    onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter,
    onGroupingChange: setGrouping, onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(), getRowId: r => r.id, autoResetExpanded: false,
  })
  const all = table.getRowModel().rows
  const last = cols.length - 1

  const gridColumns = useMemo(() => cols.map(c => {
    const s = sorting.find(x => x.id === c.id)
    return { id: c.id, title: c.title + (s ? (s.desc ? ' ▼' : ' ▲') : ''), width: widths[c.id] }
  }), [cols, widths, sorting])

  const getCellContent = useCallback(([c, r]) => {
    const row = all[r]
    if (row.getIsGrouped()) {
      const text = `${row.getIsExpanded() ? '▾' : '▸'} ${row.groupingValue} (${row.subRows.length})`
      return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: false, readonly: true, span: [0, last] }
    }
    const col = cols[c], v = row.original[col.id]
    return col.num
      ? { kind: GridCellKind.Number, data: v, displayData: String(v), allowOverlay: true }
      : { kind: GridCellKind.Text, data: String(v), displayData: String(v), allowOverlay: true }
  }, [all])

  const groupTheme = { bgCell: '#e8eefc', bgCellMedium: '#e8eefc' }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 4 }}>
        <input placeholder="Поиск" value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} />
        <button onClick={() => setGrouping(grouping.length ? [] : ['status'])}>Группировка по статусу: {grouping.length ? 'вкл' : 'выкл'}</button>
        <span> {table.getFilteredRowModel().rows.length} записей</span>
      </div>
      <div style={{ flex: 1 }}>
        <DataEditor columns={gridColumns} rows={all.length} getCellContent={getCellContent} rowMarkers="number"
          width="100%" height="100%" smoothScrollY getCellsForSelection onPaste
          getRowThemeOverride={r => all[r]?.getIsGrouped() ? groupTheme : undefined}
          onCellClicked={([, r]) => { if (all[r].getIsGrouped()) all[r].toggleExpanded() }}
          onCellEdited={([c, r], v) => { if (!all[r].getIsGrouped()) update(all[r].original._i, cols[c].id, v.data) }}
          onColumnResize={(col, w) => setWidths(x => ({ ...x, [col.id]: w }))}
          onHeaderClicked={c => table.getColumn(cols[c].id).toggleSorting()} />
      </div>
    </div>)
}
