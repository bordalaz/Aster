import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server.js'
import Pages from './Pages.jsx'

const page = {
  id: 1, title: 'Рейсы APS', filters: [{ id: 'f', table: 5, label: 'Год', conds: [{ col: 'god', op: 'eq', value: null }] }],
  rows: [[[{ type: 'number', table: 5, col: 'm', agg: 'sum', label: 'Пробурено метров', color: 'lightBlue', filter: 'f', w: 4, h: 2 }],
          [{ type: 'number', table: 5, col: null, agg: 'count', label: 'Всего', color: 'lightGreen', filter: 'f', w: 4, h: 2 }]],
         [[{ type: 'chart', kind: 'bar', table: 5, title: 'По годам', x: 'god', group: null, y: { agg: 'count', col: null }, filter: 'f', w: 6, h: 6 }]]],
}
const fields = [
  { column_name: 'm', title: 'Метры', kind: 'number', options: { precision: 0 } },
  { column_name: 'god', title: 'Год', kind: 'singleSelect', options: { choices: [{ name: '2024' }, { name: '2025' }] } },
]
const rows = [{ id: 1, m: 100, god: '2024' }, { id: 2, m: 50, god: '2025' }, { id: 3, m: 25, god: '2025' }]

function mock() {
  server.use(
    http.get('/api/pages', () => HttpResponse.json([{ id: 1, title: 'Рейсы APS' }])),
    http.get('/api/pages/1', () => HttpResponse.json(page)),
    http.get('/api/tables/5/fields', () => HttpResponse.json(fields)),
    http.get('/api/tables/5/records', () => HttpResponse.json(rows)),
  )
}

const tile = label => screen.getByText(label).closest('.dash-tile')

describe('Интерфейсы', () => {
  it('плитки считают итог, фильтр страницы их пересчитывает', async () => {
    mock()
    render(<Pages />)
    expect(await within(await screen.findByText('Пробурено метров').then(() => tile('Пробурено метров'))).findByText('175')).toBeInTheDocument()
    expect(within(tile('Всего')).getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Столбчатая диаграмма' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), '2025')
    expect(within(tile('Пробурено метров')).getByText('75')).toBeInTheDocument()
    expect(within(tile('Всего')).getByText('2')).toBeInTheDocument()
  })
})
