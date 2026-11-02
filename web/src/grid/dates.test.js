import { describe, expect, it } from 'vitest'
import { displayValue, sortKey } from './cells.js'
import { groupRows } from './layout.js'

// образцы сняты из живого Airtable владельца 2026-11-02
const local = { dateFormat: { name: 'local', format: 'l' } }
describe('даты как в Airtable', () => {
  it('local и friendly, дата без времени', () => {
    expect(displayValue({ kind: 'date', options: local }, '2024-08-22')).toBe('22.8.2024')
    expect(displayValue({ kind: 'rollup', options: { result: { type: 'date', options: { dateFormat: { name: 'friendly' } } } } }, '2021-11-23'))
      .toBe('23 Ноября 2021 г.')
  })
  it('дата и время: utc — по UTC, 24 часа; 12 часов — «дня»', () => {
    expect(displayValue({ kind: 'dateTime', options: { ...local, timeFormat: { name: '24hour' }, timeZone: 'utc' } }, '2018-03-23T20:30:00+00:00'))
      .toBe('23.3.2018 20:30')
    expect(displayValue({ kind: 'lastModifiedTime', options: { result: { type: 'dateTime', options: { ...local, timeFormat: { name: '12hour' }, timeZone: 'Asia/Tomsk' } } } },
      '2020-11-15T08:58:00.000Z')).toBe('15.11.2020 3:58дня')
  })
  it('группы по дате идут по времени, а не по тексту', () => {
    const f = { kind: 'date', column_name: 'd', options: local }
    const rows = [{ id: 1, d: '2018-03-23' }, { id: 2, d: '2018-12-01' }, { id: 3, d: '2018-03-05' }]
    expect(groupRows(rows, f).filter(i => i.kind === 'group').map(i => i.key)).toEqual(['5.3.2018', '23.3.2018', '1.12.2018'])
    expect(sortKey(f, '2018-03-05')).toBe('2018-03-05')
  })
})

describe('фильтры по датам', async () => {
  const { applyFilters } = await import('./viewConfig.js')
  it('сравнивают день, а не показанный текст «22.8.2024»', () => {
    const f = { kind: 'date', column_name: 'd', options: local }
    const t = { kind: 'dateTime', column_name: 'd', options: { ...local, timeFormat: { name: '24hour' }, timeZone: 'utc' } }
    const rows = [{ id: 1, d: '2024-08-22' }, { id: 2, d: '2024-09-01' }]
    expect(applyFilters([f], rows, [{ col: 'd', op: 'eq', value: '2024-08-22' }]).map(r => r.id)).toEqual([1])
    expect(applyFilters([f], rows, [{ col: 'd', op: 'gt', value: '2024-08-31' }]).map(r => r.id)).toEqual([2])
    expect(applyFilters([t], [{ id: 3, d: '2024-08-22T20:30:00.000Z' }], [{ col: 'd', op: 'eq', value: '2024-08-22' }]).map(r => r.id)).toEqual([3])
  })
})
