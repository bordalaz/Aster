import React, { useMemo, useRef, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getGroupedRowModel, getExpandedRowModel, flexRender,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

function EditCell({ getValue, row, column, table }) {
  const [edit, setEdit] = useState(false)
  if (!edit) return <div onDoubleClick={() => setEdit(true)} style={{ minHeight: 18 }}>{String(getValue() ?? '')}</div>
  return <input autoFocus defaultValue={getValue()} style={{ width: '100%' }}
    onBlur={e => { table.options.meta.update(row.original._i, column.id, e.target.value); setEdit(false) }}
    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEdit(false) }} />
}

export default function TanStackGrid({ rows, cols, update }) {
  const data = useMemo(() => rows.map((r, i) => ({ ...r, _i: i })), [rows])
  const columns = useMemo(() => cols.map(c => ({ accessorKey: c.id, header: c.title, size: c.width, cell: EditCell })), [cols])
  const [sorting, setSorting] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [grouping, setGrouping] = useState([])
  const table = useReactTable({
    data, columns, state: { sorting, globalFilter, grouping },
    onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter, onGroupingChange: setGrouping,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(), columnResizeMode: 'onChange', meta: { update },
    getRowId: r => r.id, autoResetExpanded: false,
  })
  const all = table.getRowModel().rows
  const ref = useRef(null)
  const v = useVirtualizer({ count: all.length, getScrollElement: () => ref.current, estimateSize: () => 26, overscan: 20 })
  const w = table.getTotalSize()
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 4 }}>
        <input placeholder="Поиск" value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} />
        <button onClick={() => setGrouping(grouping.length ? [] : ['status'])}>Группировка по статусу: {grouping.length ? 'вкл' : 'выкл'}</button>
        <span> {table.getFilteredRowModel().rows.length} записей</span>
      </div>
      <div ref={ref} style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ width: w, position: 'sticky', top: 0, zIndex: 1, background: '#f3f3f3', display: 'flex' }}>
          {table.getFlatHeaders().map(h => (
            <div key={h.id} style={{ width: h.getSize(), position: 'relative', padding: 4, borderRight: '1px solid #ddd', cursor: 'pointer', boxSizing: 'border-box' }}
              onClick={h.column.getToggleSortingHandler()}>
              {flexRender(h.column.columnDef.header, h.getContext())}{{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted()] ?? ''}
              <div onMouseDown={h.getResizeHandler()} onClick={e => e.stopPropagation()}
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize' }} />
            </div>
          ))}
        </div>
        <div style={{ height: v.getTotalSize(), width: w, position: 'relative' }}>
          {v.getVirtualItems().map(vi => {
            const row = all[vi.index]
            return (
              <div key={row.id} style={{ position: 'absolute', top: vi.start, height: 26, display: 'flex', borderBottom: '1px solid #eee', background: row.getIsGrouped() ? '#e8eefc' : '#fff' }}>
                {row.getIsGrouped()
                  ? <div style={{ padding: 4, cursor: 'pointer' }} onClick={row.getToggleExpandedHandler()}>
                      {row.getIsExpanded() ? '▾' : '▸'} {String(row.groupingValue)} ({row.subRows.length})</div>
                  : row.getVisibleCells().map(c => (
                      <div key={c.id} style={{ width: c.column.getSize(), padding: 4, overflow: 'hidden', whiteSpace: 'nowrap', borderRight: '1px solid #eee', boxSizing: 'border-box' }}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </div>))}
              </div>)
          })}
        </div>
      </div>
    </div>)
}
