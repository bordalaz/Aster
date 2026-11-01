import { expect, test } from 'vitest'
import { columnTotal, csvCell, groupRows, parsePastedBool, parsePastedNumber, toCSV } from './layout.js'

const status = { column_name: 's', title: 'Статус', kind: 'singleLineText', options: {} }
const qty = { column_name: 'q', title: 'Кол-во', kind: 'number', options: { precision: 2 } }
const rows = [
  { id: 1, s: 'Брак', q: 1.5 }, { id: 2, s: 'В работе', q: 2 }, { id: 3, s: null, q: null }, { id: 4, s: 'Брак', q: 3 },
]

test('группировка: группы по названию, пустые в конце, порядок строк сохраняется', () => {
  const items = groupRows(rows, status)
  expect(items.map(i => (i.kind === 'group' ? `[${i.key}:${i.count}]` : i.row.id))).toEqual(
    ['[Брак:2]', 1, 4, '[В работе:1]', 2, '[—:1]', 3])
  const folded = groupRows(rows, status, new Set(['Брак']))
  expect(folded.map(i => (i.kind === 'group' ? `[${i.key}]` : i.row.id))).toEqual(['[Брак]', '[В работе]', 2, '[—]', 3])
  expect(groupRows(rows, null)).toHaveLength(4)
})

test('группировка в несколько уровней: вложенные заголовки, свёртка по пути', () => {
  const big = { column_name: 'b', title: 'Крупно', kind: 'singleLineText', options: {} }
  const rs = rows.map(r => ({ ...r, b: r.id < 3 ? 'А' : 'Б' }))
  const show = items => items.map(i => (i.kind === 'group' ? `${'>'.repeat(i.depth)}[${i.key}:${i.count}]` : i.row.id))
  expect(show(groupRows(rs, [big, status]))).toEqual(
    ['[А:2]', '>[Брак:1]', 1, '>[В работе:1]', 2, '[Б:2]', '>[Брак:1]', 4, '>[—:1]', 3])
  const folded = groupRows(rs, [big, status], new Set(['Б']))
  expect(show(folded).slice(-1)).toEqual(['[Б:2]'])
})

test('итоги: сумма чисел с точностью поля; иначе — сколько заполнено', () => {
  expect(columnTotal(qty, rows)).toBe('Σ 6.50')
  expect(columnTotal(status, rows)).toBe('заполнено 3')
  expect(columnTotal(qty, [{ q: null }])).toBe('')
  expect(columnTotal({ ...qty, kind: 'formula', options: { result: { type: 'number', options: { precision: 0 } } } }, [{ q: 0.1 }, { q: 0.2 }])).toBe('Σ 0')
})

test('CSV: «;», BOM, запятая в дробях, кавычки, защита от формул (E19)', () => {
  expect(csvCell(qty, 1234.5)).toBe('1234,50')
  expect(csvCell(qty, -5)).toBe('-5,00')                 // отрицательное число — не формула
  expect(csvCell(status, '=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
  expect(csvCell(status, '+7 999')).toBe(`"'+7 999"`)
  expect(csvCell(status, '@SUM(A1)')).toBe(`"'@SUM(A1)"`)
  expect(csvCell(status, 'a;b')).toBe('"a;b"')
  expect(csvCell(status, null)).toBe('')
  const csv = toCSV([status, qty], rows.slice(0, 2))
  expect(csv.startsWith('﻿Статус;Кол-во\r\n')).toBe(true)
  expect(csv).toContain('Брак;1,50\r\n')
})

test('вставка: русские числа и галочки', () => {
  expect(parsePastedNumber('1 234,5')).toBe(1234.5)
  expect(parsePastedNumber('1 000')).toBe(1000)
  expect(parsePastedNumber('')).toBe(null)
  expect(parsePastedNumber('abc')).toBe(undefined)
  expect(parsePastedBool('ИСТИНА')).toBe(true)
  expect(parsePastedBool('да')).toBe(true)
  expect(parsePastedBool('')).toBe(false)
})
