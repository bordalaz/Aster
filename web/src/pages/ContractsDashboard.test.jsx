import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ContractsDashboard, { summarizeContracts } from './ContractsDashboard.jsx'

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
})
