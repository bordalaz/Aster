import { expect, test } from 'vitest'
import { applyFilters, matches, sameConfig, visibleColumns } from './viewConfig.js'

const F = {
  name: { column_name: 'name', kind: 'singleLineText', options: {} },
  qty: { column_name: 'qty', kind: 'number', options: { precision: 0 } },
  ok: { column_name: 'ok', kind: 'checkbox', options: {} },
  due: { column_name: 'due', kind: 'date', options: {} },
}
const fields = Object.values(F)

test('первичное поле всегда первое; порядок и скрытие — из вида', () => {
  const cols = visibleColumns(fields, 'name', ['qty', 'name', 'gone'])
  expect(cols.map(c => c.column_name)).toEqual(['name', 'qty'])
  expect(visibleColumns(fields, 'name', undefined).map(c => c.column_name)).toEqual(['name', 'qty', 'ok', 'due'])
  expect(visibleColumns(fields, 'name', []).map(c => c.column_name)).toEqual(['name'])
})

test('условия фильтра', () => {
  expect(matches(F.name, 'Кольцо 5', { op: 'contains', value: 'кольцо' })).toBe(true)
  expect(matches(F.name, 'Кольцо', { op: 'not_contains', value: 'втул' })).toBe(true)
  expect(matches(F.qty, 10, { op: 'gt', value: '9' })).toBe(true)
  expect(matches(F.qty, 10, { op: 'lte', value: '9' })).toBe(false)
  expect(matches(F.qty, 2, { op: 'gt', value: '10' })).toBe(false)          // числа, а не строки
  expect(matches(F.qty, null, { op: 'gt', value: '1' })).toBe(false)
  expect(matches(F.due, '2026-03-01', { op: 'lt', value: '2026-10-01' })).toBe(true)
  expect(matches(F.ok, true, { op: 'eq', value: 'true' })).toBe(true)
  expect(matches(F.name, '', { op: 'empty' })).toBe(true)
  expect(matches(F.name, [], { op: 'empty' })).toBe(true)
  expect(matches(F.name, 'x', { op: 'not_empty' })).toBe(true)
})

test('фильтры складываются по «и»; недозаполненный фильтр не действует', () => {
  const rows = [{ name: 'Кольцо', qty: 5 }, { name: 'Кольцо', qty: 50 }, { name: 'Втулка', qty: 50 }]
  expect(applyFilters(fields, rows, [{ col: 'name', op: 'contains', value: 'кол' }, { col: 'qty', op: 'gte', value: 10 }]))
    .toEqual([{ name: 'Кольцо', qty: 50 }])
  expect(applyFilters(fields, rows, [{ col: 'name', op: 'contains', value: '' }])).toHaveLength(3)
  expect(applyFilters(fields, rows, [{ col: 'gone', op: 'eq', value: 1 }])).toHaveLength(3)
})

test('сравнение конфигов без учёта порядка ключей', () => {
  expect(sameConfig({ sort: [], columns: ['a'] }, { columns: ['a'], sort: [] })).toBe(true)
  expect(sameConfig({ columns: ['a'] }, { columns: ['b'] })).toBe(false)
  expect(sameConfig({}, { filters: null })).toBe(true)
})
