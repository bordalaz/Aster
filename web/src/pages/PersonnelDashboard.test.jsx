import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PersonnelDashboard from './PersonnelDashboard.jsx'

const fields = Object.fromEntries(['№', 'Фамилия Имя Отчество', 'Статус', 'Рейтинг APS', 'Всего рейсов с APS', 'Всего работ с APS', 'Всего отказов', 'ID_Рейсы APS', 'ID_НПВ', 'Телефон', 'Email'].map((title, i) => [`f${i}`, { title }]))
const rows = [
  { id: 1, f0: 1, f1: 'Анна Иванова', f2: 'В штате', f3: 8, f4: 12, f5: 7, f6: 2, f7: [{ id: 10 }, { id: 11 }], f8: [], f9: '+7 111', f10: 'anna@example.test' },
  { id: 2, f0: 2, f1: 'Борис Петров', f2: 'В штате', f3: null, f4: 8, f5: 0, f6: 0, f7: [{ id: 12 }], f8: [{ id: 21 }], f9: null, f10: null },
  { id: 3, f0: 3, f1: 'Вера Сидорова', f2: 'Уволился', f3: 0, f4: 0, f5: null, f6: null, f7: [], f8: [] },
]

describe('PersonnelDashboard', () => {
  it('shows all staff and calculates participation totals, rating, and incident people', () => {
    render(<PersonnelDashboard fields={fields} rows={rows} />)
    const metrics = document.querySelector('.personnel-metrics')
    expect(within(metrics).getByText('20')).toBeInTheDocument()
    expect(within(metrics).getByText('8')).toBeInTheDocument()
    expect(within(metrics).getByText('1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Статус')).not.toBeInTheDocument()
  })
  it('preserves zero versus null and filters by search; reset restores defaults', () => {
    render(<PersonnelDashboard fields={fields} rows={rows} />)
    fireEvent.change(screen.getByLabelText('Поиск по ФИО'), { target: { value: 'Анна' } })
    expect(screen.getByText('1 сотрудников')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Поиск по ФИО'), { target: { value: 'НесуществующееИмя' } })
    expect(screen.getByText('Сотрудники по запросу «НесуществующееИмя» не найдены. Проверьте написание ФИО.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить поиск' }))
    fireEvent.click(screen.getByRole('button', { name: 'Показать сотрудников' }))
    const table = within(screen.getByRole('table'))
    expect(table.getAllByText('0').length).toBeGreaterThan(0)
    expect(table.getAllByText('—').length).toBeGreaterThan(0)
  })
  it('opens an employee card from the directory', () => {
    const onOpen = vi.fn()
    render(<PersonnelDashboard fields={fields} rows={rows} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Показать сотрудников' }))
    const table = within(screen.getByRole('table'))
    const row = table.getByText('Анна Иванова').closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Открыть' }))
    expect(onOpen).toHaveBeenCalledWith(1)
  })
  it('exports the current dashboard to print', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<PersonnelDashboard fields={fields} rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Печать / PDF' }))
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })
})
