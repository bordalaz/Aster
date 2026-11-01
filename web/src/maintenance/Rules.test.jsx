import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import Rules from './Rules.jsx'

const rules = [
  { id: 1, match: ['Пульсатор'], kind: 'to', level: 'ТО-1', hours: null, months: null, on_arrival: true, resets: [] },
  { id: 2, match: ['Пульсатор'], kind: 'to', level: 'ТО-2', hours: 250, months: null, on_arrival: false, resets: ['ТО-2', 'ТО-3'] },
  { id: 3, match: ['тип:Трубное'], kind: 'defect', level: null, hours: 500, months: 6, on_arrival: false, resets: ['дефектоскопия'] },
]

test('админ меняет порог; пользователь только смотрит', async () => {
  let patched = null
  server.use(
    http.get('/api/maintenance/rules', () => HttpResponse.json(rules)),
    http.patch('/api/maintenance/rules/2', async ({ request }) => { patched = await request.json(); return HttpResponse.json({ ok: true }) }),
  )
  const { unmount } = render(<Rules user={{ role: 'user' }} />)
  expect(await screen.findByText('всё Трубное')).toBeInTheDocument()
  expect(screen.queryByRole('spinbutton')).toBeNull()
  unmount()

  render(<Rules user={{ role: 'admin' }} />)
  const h = await screen.findByLabelText('Часы: Пульсатор ТО-2')
  expect(screen.queryByLabelText('Часы: Пульсатор ТО-1')).toBeNull()        // «при поступлении» — без порога
  await userEvent.clear(h)
  await userEvent.type(h, '300')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Сохранено')
  expect(patched).toEqual({ hours: 300, months: null })
})
