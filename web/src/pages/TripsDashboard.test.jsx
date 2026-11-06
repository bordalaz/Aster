import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TripsDashboard from './TripsDashboard.jsx'

const fields = {
  trip: { title: 'ID_Рейса_APS' }, start: { title: 'Начало' }, status: { title: 'Статус' },
  hours: { title: 'Циркуляция, час' }, npv: { title: 'Время НПВ' }, failure: { title: 'Отказ ТС' },
  work: { title: 'ID_Работа' }, engineer: { title: 'ID_Инженеры' }, customer: { title: 'Заказчик' }, note: { title: 'Примечание' },
}
const rows = [
  { id: 1, trip: 'Р-101', start: '2026-02-02', status: 'В работе', hours: 12, npv: null, failure: false, work: [{ id: 7 }], engineer: [{ name: 'Иванов' }], customer: [{ name: 'Альфа' }] },
  { id: 2, trip: 'Р-102', start: '2026-02-03', status: 'Планируется', hours: 0, npv: 0, failure: true, work: [{ id: 8 }], engineer: [{ name: 'Петров' }], customer: [{ name: 'Бета' }] },
  { id: 3, trip: 'Р-103', start: '2026-03-03', status: 'Закончен', hours: 8, npv: 1, failure: false, work: [{ id: 7 }], engineer: [{ name: 'Иванов' }], customer: [{ name: 'Альфа' }] },
]

describe('Рейсы APS — аналитический дашборд', () => {
  it('фильтрует таблицу и пересчитывает итоги', () => {
    render(<TripsDashboard fields={fields} rows={rows} />)
    expect(within(screen.getByLabelText('Всего рейсов')).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Активные работы')).getByText('1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'В работе' } })
    expect(within(screen.getByLabelText('Всего рейсов')).getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Р-101')).toBeInTheDocument()
    expect(screen.queryByText('Р-102')).not.toBeInTheDocument()
  })

  it('отличает пустое НПВ от явного нуля', () => {
    render(<TripsDashboard fields={fields} rows={rows} />)
    const rowWithNull = screen.getByText('Р-101').closest('tr')
    const rowWithZero = screen.getByText('Р-102').closest('tr')
    expect(within(rowWithNull).getAllByText('—').length).toBeGreaterThan(0)
    expect(within(rowWithZero).getAllByText('0 ч')).toHaveLength(2)
  })

  it('передаёт id выбранного рейса в обработчик открытия', () => {
    const onOpen = vi.fn()
    render(<TripsDashboard fields={fields} rows={rows} onOpen={onOpen} />)
    fireEvent.click(within(screen.getByText('Р-101').closest('tr')).getByRole('button', { name: 'Открыть' }))
    expect(onOpen).toHaveBeenCalledWith(1)
  })
})
