import { describe, expect, it } from 'vitest'
import { aggregate, applyConds, series } from './dash.js'

const F = {
  m: { column_name: 'm', kind: 'number', options: { precision: 0 } },
  god: { column_name: 'god', kind: 'singleSelect', options: { choices: [{ name: '2024', color: 'blueLight2' }, { name: '2025', color: 'redLight2' }] } },
  d: { column_name: 'd', kind: 'date', options: {} },
  who: { column_name: 'who', kind: 'multipleRecordLinks', options: {} },
}
const R = [
  { id: 1, m: 10, god: '2024', d: '2024-01-05', who: ['ГПНХ'] },
  { id: 2, m: 5, god: '2024', d: '2024-01-20', who: ['ГПНХ', 'Роснефть'] },
  { id: 3, m: 7, god: '2025', d: '2024-02-01', who: [] },
  { id: 4, m: null, god: null, d: null, who: null },
]

describe('дашборд: агрегаты', () => {
  it('sum/max/avg/count/unique/filled как в Airtable', () => {
    expect(aggregate(R, F.m, 'sum')).toBe(22)
    expect(aggregate(R, F.m, 'max')).toBe(10)
    expect(aggregate(R, F.m, 'avg')).toBeCloseTo(22 / 3)
    expect(aggregate(R, null, 'count')).toBe(4)
    expect(aggregate(R, F.god, 'unique')).toBe(2)
    expect(aggregate(R, F.who, 'unique')).toBe(2)   // элементы ссылок — по отдельности
    expect(aggregate(R, F.m, 'filled')).toBe(3)
  })
})

describe('дашборд: фильтр страницы', () => {
  it('условие без значения — заготовка, не фильтрует', () => {
    const conds = [{ col: 'god', op: 'not_empty' }, { col: 'god', op: 'any_of', value: null }]
    expect(applyConds(R, F, conds).map(r => r.id)).toEqual([1, 2, 3])
    expect(applyConds(R, F, [{ col: 'god', op: 'eq', value: '2025' }]).map(r => r.id)).toEqual([3])
  })
})

describe('дашборд: серии графика', () => {
  it('столбцы по X со стопкой по группе; пустые X — только если включены', () => {
    const s = series(R, F, { x: 'god', group: 'who', y: { agg: 'count', col: null }, empty: false })
    expect(s.xs).toEqual(['2024', '2025'])
    expect(s.groups).toEqual(['ГПНХ', 'Роснефть', '(пусто)'])
    expect(s.value('2024', 'ГПНХ')).toBe(2)
    expect(s.value('2024', 'Роснефть')).toBe(1)
    expect(s.value('2025', '(пусто)')).toBe(1)
    expect(series(R, F, { x: 'god', y: { agg: 'count', col: null }, empty: true }).xs).toEqual(['2024', '2025', '(пусто)'])
  })
  it('даты по месяцам, сумма по полю', () => {
    const s = series(R, F, { x: 'd', bucket: 'month', y: { agg: 'sum', col: 'm' } })
    expect(s.xs).toEqual(['2024-01', '2024-02'])
    expect(s.value('2024-01', null)).toBe(15)
  })
  it('все серии, сколько есть, — без «Другое», как в Airtable', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: i, g: `г${i}`, x: 'a', n: 12 - i }))
    const fs = { g: { column_name: 'g', kind: 'singleLineText' }, x: { column_name: 'x', kind: 'singleLineText' }, n: { column_name: 'n', kind: 'number' } }
    const s = series(many, fs, { x: 'x', group: 'g', y: { agg: 'sum', col: 'n' } })
    expect(s.groups).toHaveLength(12)
    expect(s.groups).not.toContain('Другое')
  })
  it('месяц, где сумма только по пустым ячейкам, на ось не попадает', () => {
    const rs = [{ id: 1, d: '2024-01-05', m: 3 }, { id: 2, d: '2024-05-01', m: null }]
    expect(series(rs, F, { x: 'd', bucket: 'month', y: { agg: 'sum', col: 'm' } }).xs).toEqual(['2024-01'])
    expect(series(rs, F, { x: 'd', bucket: 'month', y: { agg: 'count', col: null } }).xs).toEqual(['2024-01', '2024-05'])
  })
})
