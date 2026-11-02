import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import Comments from './Comments.jsx'

test('комментарий: Enter отправляет, список обновляется; своё можно удалить', async () => {
  let list = []
  server.use(
    http.get('/api/tables/1/records/5/comments', () => HttpResponse.json(list)),
    http.post('/api/tables/1/records/5/comments', async ({ request }) => {
      const { text } = await request.json()
      list = [...list, { id: 1, text, at: '2026-11-02T10:00:00Z', user: 'Иван', mine: true }]
      return HttpResponse.json({ id: 1 })
    }),
    http.delete('/api/tables/1/records/5/comments/1', () => { list = []; return HttpResponse.json({ ok: true }) }),
  )
  render(<Comments tableId={1} recordId={5} />)
  expect(await screen.findByText('Начните обсуждение')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Комментарий'), 'проверить резьбу{Enter}')
  expect(await screen.findByText('проверить резьбу')).toBeInTheDocument()
  expect(screen.getByLabelText('Комментарий')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Удалить комментарий' }))
  expect(await screen.findByText('Начните обсуждение')).toBeInTheDocument()
})
