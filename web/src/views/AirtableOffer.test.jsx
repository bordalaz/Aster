import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'
import { server } from '../test/server.js'
import AirtableOffer from './AirtableOffer.jsx'

test('автору — его виды Airtable на выбор; «Не нужно» отправляет пустой список', async () => {
  let sent = null
  server.use(
    http.get('/api/views/airtable/offer', () => HttpResponse.json([
      { id: 1, title: 'Юрий\'s Calendar', kind: 'calendar', table_id: 5, table: 'Перемещение' },
      { id: 2, title: 'Полный Ю', kind: 'grid', table_id: 6, table: 'Оборудование' }])),
    http.post('/api/views/airtable/offer', async ({ request }) => { sent = await request.json(); return HttpResponse.json({ ok: true }) }),
  )
  render(<AirtableOffer />)
  expect(await screen.findByRole('dialog', { name: 'Ваши виды из Airtable' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Перенести (2)' })).toBeEnabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Полный Ю' }))
  expect(screen.getByRole('button', { name: 'Перенести (1)' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Не нужно' }))
  await vi.waitFor(() => expect(sent).toEqual({ ids: [] }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
