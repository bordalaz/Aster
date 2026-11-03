import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import CalendarView, { monthGrid, placeWeek, shiftDate } from './CalendarView.jsx'

test('сетка месяца: 6 недель с понедельника', () => {
  const w = monthGrid(2026, 11)            // 1.11.2026 — воскресенье → сетка с 26.10
  expect(w).toHaveLength(6)
  expect(new Date(w[0] * 86400000).toISOString().slice(0, 10)).toBe('2026-10-26')
})

test('дорожки недели: длинные выше, пересечения — на разных дорожках', () => {
  const ev = (id, s, e) => ({ row: { id }, s, e })
  const p = placeWeek([ev(1, 10, 10), ev(2, 8, 12), ev(3, 11, 11), ev(4, 20, 21)], 7)
  const lane = id => p.find(x => x.row.id === id).lane
  expect(p.map(x => x.row.id)).toEqual([2, 1, 3])   // 4 — вне недели
  expect([lane(2), lane(1), lane(3)]).toEqual([0, 1, 1])
  expect(p.find(x => x.row.id === 2)).toMatchObject({ from: 1, to: 5 })
})

test('сдвиг даты: дата и дата со временем (зона поля сохраняется)', () => {
  expect(shiftDate({ kind: 'date' }, '2026-10-30', 3)).toBe('2026-11-02')
  const dt = { kind: 'dateTime', options: { timeZone: 'utc', timeFormat: { name: '24hour' } } }
  expect(shiftDate(dt, '2026-10-27T12:30:00.000Z', 2)).toBe('2026-10-29T12:30:00.000Z')
})

test('полоса записи с подписью, «+N ещё» и попап дня, щелчок открывает запись', () => {
  const fields = [{ column_name: 'name', kind: 'singleLineText', title: 'Имя' }, { column_name: 'ok', kind: 'checkbox' }, { column_name: 'n', kind: 'number' }, { column_name: 'd', kind: 'date', title: 'Дата', editable: true }]
  const now = new Date(), ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
  const rows = [1, 2, 3, 4, 5].map(id => ({ id, name: `Рейс ${id}`, d: ymd, ok: false, n: null }))
  const onOpen = vi.fn()
  render(<CalendarView fields={fields} rows={rows} primaryField="name" config={{ start: 'd', columns: ['name', 'ok', 'n'] }} onOpen={onOpen} onMove={() => {}} />)
  expect(screen.getAllByRole('button', { name: /^Рейс/ })).toHaveLength(3)
  fireEvent.click(screen.getByText('+2 ещё'))
  expect(screen.getByRole('dialog', { name: /^15 / })).toBeTruthy()   // «15 ноября» — родительный падеж
  expect(screen.getAllByRole('button', { name: /^Рейс/ })).toHaveLength(8)
  fireEvent.click(screen.getAllByRole('button', { name: 'Рейс 1' })[0])
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), [1, 2, 3, 4, 5])
})

import { daySlices, periodTitle, rowsFor } from './CalendarView.jsx'

test('режимы: строки сетки и заголовок периода', () => {
  const D = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
  const tue = D(2026, 11, 3)
  expect(rowsFor('week', tue)).toEqual([[D(2026, 11, 2), 7]])                       // неделя с понедельника
  expect(rowsFor('2week', tue)).toEqual([[D(2026, 11, 2), 7], [D(2026, 11, 9), 7]])
  expect(rowsFor('3day', tue)).toEqual([[tue, 3]])
  expect(rowsFor('day', tue)).toEqual([[tue, 1]])
  expect(rowsFor('month', tue)).toHaveLength(6)
  expect(periodTitle('week', D(2026, 11, 2), D(2026, 11, 8))).toBe('2 – 8 ноября 2026')
  expect(periodTitle('week', D(2026, 10, 26), D(2026, 11, 1))).toBe('26 октября – 1 ноября 2026')
  expect(periodTitle('day', tue, tue)).toBe('3 ноября 2026')
})

test('сетка по часам: запись режется по дням, пересекающиеся — на соседних дорожках', () => {
  const ev = (id, t0, t1) => ({ row: { id }, t0, t1 })
  const d = 100
  const s = daySlices([ev(1, d - 0.5, d + 0.25), ev(2, d + 0.1, d + 0.3), ev(3, d + 0.5, d + 0.6), ev(4, d + 1.2, d + 1.3)], d)
  const r2 = v => Math.round(v * 100) / 100
  expect(s.map(x => [x.row.id, r2(x.a), r2(x.b), x.lane])).toEqual([[1, 0, 0.25, 0], [2, 0.1, 0.3, 1], [3, 0.5, 0.6, 0]])
  expect(s.every(x => x.lanes === 2)).toBe(true)
})

test('неделя у даты со временем — сетка по часам; у даты без времени — полосы', async () => {
  const now = new Date(), ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dt = { column_name: 'd', kind: 'dateTime', title: 'Начало', editable: true, options: { timeZone: 'utc', timeFormat: { name: '24hour' } } }
  const name = { column_name: 'name', kind: 'singleLineText', title: 'Имя' }
  const { container, unmount } = render(<CalendarView fields={[name, dt]} rows={[{ id: 1, name: 'Рейс 1', d: `${ymd}T10:30:00.000Z` }]}
    primaryField="name" config={{ start: 'd', columns: ['name'] }} onOpen={() => {}} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Режим' }), { target: { value: 'week' } })
  expect(container.querySelectorAll('.cal-hlabels span')).toHaveLength(24)
  expect(container.querySelector('.cal-slot[data-id="1"]').textContent).toBe('10:30Рейс 1')
  unmount()
  const date = { ...dt, kind: 'date', options: {} }
  const r2 = render(<CalendarView fields={[name, date]} rows={[{ id: 1, name: 'Сборка', d: ymd }]} primaryField="name" config={{ start: 'd', columns: ['name'] }} onOpen={() => {}} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Режим' }), { target: { value: 'week' } })
  expect(r2.container.querySelector('.cal-hours')).toBeNull()
  expect(r2.container.querySelector('.cal-bar[data-id="1"]')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Выходные' }), { target: { value: 'hide' } })
  expect(r2.container.querySelector('.cal-week').style.gridTemplateColumns).toMatch(/ 0 0$/)
})
