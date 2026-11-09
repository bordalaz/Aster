import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ContractsDashboard, { linkTargets, summarizeContracts } from './ContractsDashboard.jsx'

const fields = Object.fromEntries([
  ['code', 'Код_Договора'], ['number', '№ Договора'], ['type', 'Тип'], ['status', 'Статус'], ['contractor', 'Подрядчики'],
  ['account', 'Счет'], ['subject', 'Предмет договора'], ['limit', 'Сумма договора, руб'], ['remaining', 'Остаток, руб'],
  ['invoice20', 'Сумма по счф 20, руб'], ['invoice23', 'Сумма по счф 23, руб'], ['expiration', 'Срок действия'],
  ['signed', 'Дата заключения'], ['parent', 'ID_Договор'],
].map(([key, title]) => [key, { title }]))
const rows = [
  { id: 1, code: 'D-1', number: 'A-10', type: 'Договор', status: 'Действующий', contractor: ['ООО Альфа'], account: '20', limit: 1000, remaining: 700, invoice20: 200, invoice23: 100, expiration: '2026-12-01' },
  { id: 2, code: 'D-1-1', number: 'A-10', type: 'ДС', status: 'Действующий', contractor: ['ООО Альфа'], account: '20', limit: 300, remaining: 120, invoice20: 50, invoice23: null, expiration: '2026-12-01', parent: 1 },
  { id: 3, code: 'D-2', number: 'B-20', type: 'Договор', status: 'Архивный', contractor: ['ООО Бета'], account: '23', limit: 500, remaining: -10, invoice20: null, invoice23: 30, expiration: '2025-01-01' },
]

describe('ContractsDashboard', () => {
  it('sums document metrics while grouping chart rows by agreement number', () => {
    const result = summarizeContracts(rows.slice(0, 2), Object.fromEntries(Object.entries(fields).map(([k]) => [k, k])), new Date('2026-11-06T00:00:00'))
    expect(result.limit).toBe(1300)
    expect(result.invoiced).toBe(350)
    expect(result.remaining).toBe(820)
    expect(result.grouped).toHaveLength(1)
    expect(result.grouped[0].rows).toHaveLength(2)
  })
  it('defaults to active, filters by contractor/account/type and resets filters', () => {
    render(<ContractsDashboard fields={fields} rows={rows} />)
    expect(screen.getByText('2 документов')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Подрядчик'), { target: { value: 'ООО Альфа' } })
    fireEvent.change(screen.getByLabelText('Тип документа'), { target: { value: 'ДС' } })
    expect(screen.getByText('1 документов')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Счет'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
    expect(screen.getByLabelText('Статус')).toHaveValue('Действующий')
    expect(screen.getByLabelText('Подрядчик')).toHaveValue('')
  })
  it('keeps missing financial values null and shows empty results', () => {
    const result = summarizeContracts([{ id: 4, number: 'C-1', remaining: null, invoice20: null, invoice23: null, limit: null }], { number: 'number', remaining: 'remaining', limit: 'limit', invoice20: 'invoice20', invoice23: 'invoice23' }, new Date('2026-11-06T00:00:00'))
    expect(result.limit).toBeNull()
    expect(result.remaining).toBeNull()
    expect(result.invoiced).toBeNull()
    render(<ContractsDashboard fields={fields} rows={[]} />)
    expect(screen.getByText('Нет документов по выбранным фильтрам.')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
  it('opens selected records from the chart and registry and prints', () => {
    const onOpen = vi.fn(), print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<ContractsDashboard fields={fields} rows={rows} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /A-10/ }))
    expect(onOpen).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Показать реестр' }))
    const table = within(screen.getByRole('table'))
    fireEvent.click(table.getAllByRole('button', { name: 'A-10' })[1])
    expect(onOpen).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Печать / PDF' }))
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })
  it('renders multiple parents and mixed valid/invalid parents with exact ids, titles and clicks', () => {
    const apiRows = [
      {
        id: 10, code: 'D-10', number: 'X-1', type: 'Договор', status: 'Действующий',
        contractor: [{ id: 100, name: 'ООО Альфа' }, { id: 101, name: 'ООО Бета' }],
        account: '20', subject: 'Комплекс', limit: 1000, remaining: 700, invoice20: 200, invoice23: 100, expiration: '2026-12-01',
        // multiple parents: two valid objects
        parent: [{ id: 1, name: 'Parent-A' }, { id: 2, name: 'Parent-B' }],
      },
      {
        id: 11, code: 'D-11', number: 'X-2', type: 'ДС', status: 'Действующий',
        contractor: [{ id: 100, name: 'ООО Альфа' }],
        account: '20', subject: 'Работы', limit: 300, remaining: 120, invoice20: 50, invoice23: null, expiration: '2026-12-01',
        // mixed array: valid with empty title, invalid (null/zero/float/bool/broken), and valid string id
        parent: [
          { id: 3, name: '   ' },
          null,
          { id: 0, name: 'Zero' },
          { id: 4.5, name: 'Float' },
          { id: true, name: 'Bool' },
          true,
          { id: 'broken', name: 'Broken' },
          { id: '5', name: 'Parent-Five' },
        ],
      },
      {
        id: 12, code: 'D-12', number: 'X-3', type: 'ДС', status: 'Действующий',
        contractor: [],
        account: '23', subject: null, limit: 500, remaining: 100, invoice20: null, invoice23: null, expiration: '2026-12-01',
        // scalar compatible id
        parent: 7,
      },
      {
        id: 13, code: 'D-13', number: 'X-4', type: 'ДС', status: 'Действующий',
        contractor: null,
        account: '23', subject: null, limit: 500, remaining: 100, invoice20: null, invoice23: null, expiration: '2026-12-01',
        // scalar string id
        parent: '8',
      },
      {
        id: 14, code: 'D-14', number: 'X-5', type: 'ДС', status: 'Действующий',
        contractor: null,
        account: '23', subject: null, limit: 500, remaining: 100, invoice20: null, invoice23: null, expiration: '2026-12-01',
        // invalid scalar bool, float, negative, zero
        parent: false,
      },
    ]
    const onOpen = vi.fn()
    render(<ContractsDashboard fields={fields} rows={apiRows} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Показать реестр' }))

    const table = screen.getByRole('table')
    const rowsFound = within(table).getAllByRole('row')

    // Row 1 (X-1): two parent buttons inside parent cell
    const parentCell1 = within(rowsFound[1]).getAllByRole('cell')[9]
    const btnParentA = within(parentCell1).getByRole('button', { name: 'Parent-A' })
    const btnParentB = within(parentCell1).getByRole('button', { name: 'Parent-B' })
    fireEvent.click(btnParentA)
    expect(onOpen).toHaveBeenCalledWith(1)
    fireEvent.click(btnParentB)
    expect(onOpen).toHaveBeenCalledWith(2)

    // Row 2 (X-2): valid parent with empty name defaults to id ('3'), valid string id ('5') works, invalids skipped
    const parentCell2 = within(rowsFound[2]).getAllByRole('cell')[9]
    const btnParent3 = within(parentCell2).getByRole('button', { name: '3' })
    const btnParent5 = within(parentCell2).getByRole('button', { name: 'Parent-Five' })
    expect(within(parentCell2).queryByRole('button', { name: 'Zero' })).not.toBeInTheDocument()
    expect(within(parentCell2).queryByRole('button', { name: 'Float' })).not.toBeInTheDocument()
    expect(within(parentCell2).queryByRole('button', { name: 'Bool' })).not.toBeInTheDocument()
    expect(within(parentCell2).queryByRole('button', { name: 'Broken' })).not.toBeInTheDocument()
    fireEvent.click(btnParent3)
    expect(onOpen).toHaveBeenCalledWith(3)
    fireEvent.click(btnParent5)
    expect(onOpen).toHaveBeenCalledWith(5)

    // Row 3 (X-3): scalar positive number
    const parentCell3 = within(rowsFound[3]).getAllByRole('cell')[9]
    const btnParent7 = within(parentCell3).getByRole('button', { name: '7' })
    fireEvent.click(btnParent7)
    expect(onOpen).toHaveBeenCalledWith(7)

    // Row 4 (X-4): scalar string integer
    const parentCell4 = within(rowsFound[4]).getAllByRole('cell')[9]
    const btnParent8 = within(parentCell4).getByRole('button', { name: '8' })
    fireEvent.click(btnParent8)
    expect(onOpen).toHaveBeenCalledWith(8)

    // Row 5 (X-5): boolean false -> no button, shows '—'
    const parentCell5 = within(rowsFound[5]).getAllByRole('cell')[9]
    expect(within(parentCell5).queryByRole('button')).not.toBeInTheDocument()
    expect(parentCell5).toHaveTextContent('—')

    // Negative assertions
    expect(onOpen).not.toHaveBeenCalledWith(0)
    expect(onOpen).not.toHaveBeenCalledWith(NaN)
    expect(onOpen).not.toHaveBeenCalledWith(true)
    expect(onOpen).not.toHaveBeenCalledWith(false)
    expect(onOpen).not.toHaveBeenCalledWith(4.5)
  })
  it('unit tests linkTargets for strict safe integer parsing and multiple links', () => {
    expect(linkTargets(null)).toEqual([])
    expect(linkTargets('')).toEqual([])
    expect(linkTargets(true)).toEqual([])
    expect(linkTargets(false)).toEqual([])
    expect(linkTargets(0)).toEqual([])
    expect(linkTargets(-5)).toEqual([])
    expect(linkTargets(2.5)).toEqual([])
    expect(linkTargets({ id: 1.2, name: 'Float' })).toEqual([])
    expect(linkTargets({ id: true, name: 'Bool' })).toEqual([])
    expect(linkTargets({ id: 10, name: '' })).toEqual([{ id: 10, title: '10' }])
    expect(linkTargets({ id: 10, name: 'Parent' })).toEqual([{ id: 10, title: 'Parent' }])
    expect(linkTargets([{ id: 10, name: 'P1' }, { id: 20, name: 'P2' }])).toEqual([
      { id: 10, title: 'P1' },
      { id: 20, title: 'P2' },
    ])
    expect(linkTargets([{ id: 0 }, { id: 30, name: 'P3' }, null, false])).toEqual([
      { id: 30, title: 'P3' },
    ])
  })
})
