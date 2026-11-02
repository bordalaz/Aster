import { render, screen, waitFor, within } from '@testing-library/react'
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

  it('сетка: группы по полю с суммами, итог внизу, красная метка по правилу', async () => {
    const grid = { id: 1, title: 'Договоры', filters: [], rows: [[[{ type: 'grid', table: 5, columns: ['god', 'm'], sort: [],
      groups: [{ col: 'god', desc: false }], widths: { god: 200 },
      color: { kind: 'rules', rules: [{ color: 'redDark', filters: [{ col: 'm', op: 'lt', value: 60 }] }] } }]]] }
    mock()
    server.use(http.get('/api/pages/1', () => HttpResponse.json(grid)))
    render(<Pages />)
    const g2025 = (await screen.findByText('2025', { selector: '.dash-group th, .dash-group th *' })).closest('tr')
    expect(within(g2025).getByText('2')).toBeInTheDocument()            // записей в группе
    expect(within(g2025).getByText('Сумма 75')).toBeInTheDocument()
    expect(screen.getByText('Сумма 175')).toBeInTheDocument()           // итог внизу
    const low = screen.getByText('25').closest('tr')
    expect(low.querySelector('td').style.boxShadow).toContain('inset 4px 0')
    expect(screen.getByText('100').closest('tr').querySelector('td').style.boxShadow).toBe('')
  })

  it('список + карточка: фильтр и сортировка списка, поля выбранной записи', async () => {
    const lc = { id: 1, title: 'Персонал', filters: [],
      list: { table: 5, filters: [{ col: 'god', op: 'eq', value: '2025' }], sort: [{ col: 'm', desc: false }], columns: ['m', 'god'], header: ['m'] },
      rows: [[[{ type: 'field', table: 5, col: 'god', readonly: true, w: 6 }]]] }
    mock()
    server.use(http.get('/api/pages/1', () => HttpResponse.json(lc)))
    render(<Pages />)
    const list = await screen.findByRole('navigation', { name: 'Записи' })
    const items = within(list).getAllByRole('button')
    expect(items.map(b => b.querySelector('.lc-title').textContent)).toEqual(['25', '50'])   // только 2025, по возрастанию
    expect(screen.getByRole('heading', { name: '25' })).toBeInTheDocument()                  // первая выбрана
    await userEvent.click(items[1])
    expect(screen.getByRole('heading', { name: '50' })).toBeInTheDocument()
    expect(screen.getByText('Год')).toBeInTheDocument()                                       // поле карточки
  })

  it('карточка: поле без «только чтение» правится и сохраняется при уходе с поля; фото — каруселью', async () => {
    const lc = { id: 1, title: 'ЗИП', filters: [],
      list: { table: 5, filters: [], sort: [], columns: ['m'], header: ['m'] },
      rows: [[[{ type: 'field', table: 5, col: 'note', readonly: false, w: 6 }], [{ type: 'field', table: 5, col: 'god', readonly: true, w: 6 }]],
             [[{ type: 'attachments', table: 5, col: 'foto', readonly: true, w: 6, h: 6 }]]] }
    const fs = [...fields, { column_name: 'note', title: 'Примечание', kind: 'singleLineText', editable: true },
      { column_name: 'foto', title: 'Фото', kind: 'multipleAttachments', editable: true }]
    const rs = [{ id: 1, m: 100, god: '2024', note: 'старое', updated_at: 't1',
      foto: [{ id: 'a', name: 'a.jpg', mime: 'image/jpeg' }, { id: 'b', name: 'b.png', mime: 'image/png' }] }]
    let sent = null
    mock()
    server.use(
      http.get('/api/pages/1', () => HttpResponse.json(lc)),
      http.get('/api/tables/5/fields', () => HttpResponse.json(fs)),
      http.get('/api/tables/5/records', () => HttpResponse.json(rs)),
      http.patch('/api/tables/5/records/1', async ({ request }) => { sent = await request.json(); return HttpResponse.json({ updated_at: 't2' }) }),
    )
    render(<Pages />)
    const note = await screen.findByRole('textbox', { name: 'Примечание' })
    expect(screen.queryByRole('combobox', { name: 'Год' })).toBeNull()   // «только чтение» — без редактора
    await userEvent.clear(note)
    await userEvent.type(note, 'новое{Enter}')
    await waitFor(() => expect(sent).toEqual({ updated_at: 't1', values: { note: 'новое' } }))
    expect(screen.getByRole('img', { name: 'a.jpg' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(screen.getByRole('img', { name: 'b.png' })).toBeInTheDocument()
  })
})
