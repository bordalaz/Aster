import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import { fields1, records1 } from '../test/fixtures.js'
import Card from './Card.jsx'

const rec = records1[0]

test('карточка показывает историю: кто, поле, было → стало', async () => {
  server.use(http.get(`/api/tables/1/records/${rec.id}/history`, () => HttpResponse.json([
    { at: '2026-10-31T10:00:00Z', column_name: 'f_fld00000000000002', field: 'Кол-во', old: 5, new: 9, user: 'Иван' },
    { at: '2026-10-30T10:00:00Z', column_name: 'f_fld00000000000003', field: 'На складе', old: false, new: true, user: 'система' },
  ])))
  render(<Card tableId={1} record={rec} fields={fields1} onSave={vi.fn()} onClose={vi.fn()} />)
  const h = await screen.findByRole('region', { name: 'История изменений' })
  expect(await screen.findByText(/Иван/)).toBeInTheDocument()
  expect(h).toHaveTextContent('Кол-во: 5 → 9')
  expect(h).toHaveTextContent('система')
})

test('нет изменений — так и написано', async () => {
  server.use(http.get(`/api/tables/1/records/${rec.id}/history`, () => HttpResponse.json([])))
  render(<Card tableId={1} record={rec} fields={fields1} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(await screen.findByText('Изменений не было')).toBeInTheDocument()
})

test('без прав на правку кнопки «Сохранить» нет', () => {
  const ro = fields1.map(f => ({ ...f, editable: false }))
  render(<Card record={rec} fields={ro} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
})
