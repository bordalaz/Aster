import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import TimelineView, { point, stack, totalColor } from './TimelineView.jsx'

test('точка на шкале: дата — начало/конец дня, дата со временем — доля дня в зоне поля', () => {
  const d = Date.UTC(2026, 9, 31) / 86400000
  expect(point({ kind: 'date' }, '2026-10-31', false)).toBe(d)
  expect(point({ kind: 'date' }, '2026-10-31', true)).toBe(d + 1)
  const dt = { kind: 'dateTime', options: { timeZone: 'utc', timeFormat: { name: '24hour' } } }
  expect(point(dt, '2026-10-31T12:00:00.000Z')).toBe(d + 0.5)
})

test('stacked: запись на первую освободившуюся дорожку', () => {
  expect(stack([{ t0: 0, t1: 5 }, { t0: 1, t1: 2 }, { t0: 2, t1: 3 }, { t0: 5, t1: 6 }])).toEqual([0, 1, 1, 0])
})

test('«Всего»: цвет по первому сработавшему порогу', () => {
  const rules = [{ op: '<=', value: 8, color: 'green' }, { op: '>', value: 8, color: 'pinkDark' }]
  expect(totalColor(rules, 3)).toEqual({ background: '#d1f7c4', color: '#1d1f25' })
  expect(totalColor(rules, 9).color).toBe('#fff')
  expect(totalColor(undefined, 3)).toBe(null)
})

test('группы по выбору в обратном порядке, пустые скрыты, подпись со стилем и (пусто), щелчок открывает', () => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} }
  const st = { column_name: 's', kind: 'singleSelect', title: 'Статус', options: { choices: [{ name: 'План', color: 'yellowLight2' }, { name: 'В работе', color: 'greenLight2' }, { name: 'Закончен', color: 'grayLight2' }] } }
  const fields = [{ column_name: 'name', kind: 'singleLineText', title: 'Имя' }, { column_name: 'z', kind: 'singleLineText' }, st,
    { column_name: 'a', kind: 'date', editable: true }, { column_name: 'b', kind: 'date', editable: true }]
  const now = new Date(), ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const rows = [{ id: 1, name: 'Рейс 1', s: 'План', a: ymd, b: ymd }, { id: 2, name: 'Рейс 2', s: 'В работе', a: ymd, b: ymd }]
  const onOpen = vi.fn()
  const { container } = render(<TimelineView fields={fields} rows={rows} primaryField="name" onOpen={onOpen} onMove={() => {}}
    config={{ start: 'a', end: 'b', group: ['s'], groupDesc: true, hideEmpty: true, columns: ['name', 'z'], labelStyle: { name: { bold: true } }, totals: { label: 'Всего' } }} />)
  expect([...container.querySelectorAll('.tl-left.group')].map(g => g.textContent)).toEqual(['В работе', 'План'])
  const bar = container.querySelector('.tl-bar[data-id="2"]')
  expect(bar.textContent).toBe('Рейс 2 · (пусто)')
  expect(bar.querySelector('span').style.fontWeight).toBe('600')
  expect(screen.getByText('Всего')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Рейс 1' }))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), [1, 2])
})
