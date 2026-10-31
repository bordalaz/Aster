import { useCallback, useMemo, useState } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel } from '@tanstack/react-table'
import '@glideapps/glide-data-grid/dist/index.css'
import { toCell, fromCell } from './cells.js'

function plural(n) {
  const a = n % 10, b = n % 100
  if (a === 1 && b !== 11) return 'запись'
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'записи'
  return 'записей'
}

export default function Grid({ fields, rows, primaryField, onEdit, onOpen }) {
  // Первичное поле — первой колонкой и закреплено слева (R9).
  const cols = useMemo(() => {
    const prim = fields.filter(f => f.column_name === primaryField)
    const rest = fields.filter(f => f.column_name !== primaryField)
    return [...prim, ...rest]
  }, [fields, primaryField])

  const [widths, setWidths] = useState({})
  const [sorting, setSorting] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data: rows,
    columns: useMemo(() => cols.map(c => ({ accessorKey: c.column_name })), [cols]),
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: r => String(r.id),
  })
  const view = table.getRowModel().rows

  const gridColumns = useMemo(() => cols.map(c => {
    const s = sorting.find(x => x.id === c.column_name)
    return { id: c.column_name, title: c.title + (s ? (s.desc ? ' ▼' : ' ▲') : ''), width: widths[c.column_name] ?? 160 }
  }), [cols, widths, sorting])

  const getCellContent = useCallback(([ci, ri]) => {
    const field = cols[ci]
    const value = view[ri].original[field.column_name]
    return toCell(field, value)
  }, [cols, view])

  const onCellEdited = useCallback(([ci, ri], cell) => {
    const field = cols[ci]
    if (!field.editable) return
    onEdit(view[ri].original, field.column_name, fromCell(field, cell))
  }, [cols, view, onEdit])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid var(--line)' }}>
        <input className="search" placeholder="Поиск" value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} />
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{view.length} {plural(view.length)}</span>
      </div>
      <span data-testid="col-order" style={{ display: 'none' }}>{cols.map(c => c.column_name).join(',')}</span>
      <div style={{ flex: 1 }}>
        <DataEditor
          columns={gridColumns}
          rows={view.length}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
          onCellClicked={([, ri]) => onOpen(view[ri].original)}
          onHeaderClicked={ci => table.getColumn(cols[ci].column_name).toggleSorting()}
          onColumnResize={(col, w) => setWidths(x => ({ ...x, [col.id]: w }))}
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
