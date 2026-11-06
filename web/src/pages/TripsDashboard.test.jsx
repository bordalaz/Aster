import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TripsDashboard from './TripsDashboard.jsx'

const u = value => String.fromCodePoint(...value.split(' ').map(x => parseInt(x, 16)))
const fields = {
  trip: { title: 'ID_Рейса_APS' }, start: { title: u('041d 0430 0447 0430 043b 043e') }, status: { title: u('0421 0442 0430 0442 0443 0441') },
  hours: { title: u('0426 0438 0440 043a 0443 043b 044f 0446 0438 044f 002c 0020 0447 0430 0441') }, npv: { title: u('0412 0440 0435 043c 044f 0020 041d 041f 0412') }, failure: { title: u('041e 0442 043a 0430 0437 0020 0422 0421') },
  engineer: { title: 'ID_Инженеры' }, customer: { title: u('0417 0430 043a 0430 0437 0447 0438 043a') },
}
const work = u('0412 0020 0440 0430 0431 043e 0442 0435'), planned = u('041f 043b 0430 043d 0438 0440 0443 0435 0442 0441 044f'), done = u('0417 0430 043a 043e 043d 0447 0435 043d')
const rows = [
  { id: 1, trip: 'T-101', start: '2026-02-02', status: work, hours: 12, npv: null, failure: false },
  { id: 2, trip: 'T-102', start: '2026-02-03', status: planned, hours: 0, npv: 0, failure: true },
  { id: 3, trip: 'T-103', start: '2026-03-03', status: done, hours: 8, npv: 1, failure: false },
]

describe('TripsDashboard', () => {
  it('hides registry until requested, then filters it', () => {
    render(<TripsDashboard fields={fields} rows={rows} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Показать рейсы/ }))
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: work } })
    const table = within(screen.getByRole('table'))
    expect(table.getByText('T-101')).toBeInTheDocument()
    expect(table.queryByText('T-102')).not.toBeInTheDocument()
  })
  it('preserves null versus zero and opens the selected trip', () => {
    const onOpen = vi.fn()
    render(<TripsDashboard fields={fields} rows={rows} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Показать рейсы/ }))
    const table = within(screen.getByRole('table'))
    const missing = table.getByText('T-101').closest('tr')
    const zero = table.getByText('T-102').closest('tr')
    expect(missing.textContent).not.toContain('0 ч')
    expect(within(zero).getAllByText('0 ч')).toHaveLength(2)
    fireEvent.click(within(missing).getByRole('button', { name: /Открыть/ }))
    expect(onOpen).toHaveBeenCalledWith(1)
  })
  it('applies a status filter from the legend', () => {
    const { container } = render(<TripsDashboard fields={fields} rows={rows} />)
    fireEvent.click(container.querySelector('.ops-legend button'))
    expect(container.querySelector('.ops-legend button')).toHaveAttribute('aria-pressed', 'true')
  })
  it('opens the browser print dialog for PDF export', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<TripsDashboard fields={fields} rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Печать / PDF' }))
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })
})
