import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import TimelineView, { depLinks, point, stack, totalColor } from './TimelineView.jsx'

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

import { ticks } from './TimelineView.jsx'

test('деления шкалы по масштабам', () => {
  const D = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
  const d0 = D(2026, 11, 3)
  const day = ticks('day', d0, d0)
  expect(day.top[0].label).toBe('3 ноября 2026')
  expect(day.bottom).toHaveLength(24)
  expect(day.bottom[14].label).toBe('14:00')
  expect(ticks('week', d0, d0 + 1).bottom.map(u => u.label)).toEqual(['Вт 3', 'Ср 4', 'Чт 5'])
  expect(ticks('month', d0, d0).bottom[0].label).toEqual(['В', 3])
  const q = ticks('quarter', d0, d0 + 14)
  expect(q.bottom.map(u => [u.label, u.b - u.a])).toEqual([['2', 7], ['9', 7], ['16', 7]])   // недели с понедельника
  expect(q.top[0].label).toBe('Ноябрь 2026')
  const y = ticks('year', D(2026, 11, 3), D(2027, 1, 20))
  expect(y.top.map(t => t.label)).toEqual(['4 кв. 2026', '1 кв. 2027'])
  expect(y.bottom.map(u => u.label)).toEqual(['Ноя', 'Дек', 'Янв'])
})

test('Gantt: стрелка от предшественника, красная — если запись начинается раньше его конца; чужие связи — мимо', () => {
  const p = (id, t0, t1, deps) => ({ ev: { row: { id, d: deps }, t0, t1 }, line: id })
  const a = p(1, 0, 3), b = p(2, 3, 5, [{ id: 1, name: 'A' }]), c = p(3, 2, 4, [{ id: 1 }, { id: 99 }, { id: 3 }])
  expect(depLinks([a, b, c], 'd').map(l => [l.from.ev.row.id, l.to.ev.row.id, l.late])).toEqual([[1, 2, false], [1, 3, true]])
  expect(depLinks([a, b], null)).toEqual([])
})

test('Gantt: стрелки рисуются по полю зависимостей', () => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} }
  const fields = [{ column_name: 'name', kind: 'singleLineText' }, { column_name: 'a', kind: 'date' }, { column_name: 'b', kind: 'date' },
    { column_name: 'dep', kind: 'multipleRecordLinks' }]
  const rows = [{ id: 1, name: 'A', a: '2026-11-01', b: '2026-11-03' }, { id: 2, name: 'B', a: '2026-11-02', b: '2026-11-05', dep: [{ id: 1, name: 'A' }] }]
  const { container } = render(<TimelineView fields={fields} rows={rows} primaryField="name" onOpen={() => {}} config={{ start: 'a', end: 'b', columns: ['name'], deps: 'dep' }} />)
  expect(container.querySelectorAll('.tl-deps > path.late')).toHaveLength(1)
})
