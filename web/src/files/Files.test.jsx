import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import Card from '../card/Card.jsx'
import Forms from '../forms/Forms.jsx'

const photo = { column_name: 'ph', title: 'Фото', kind: 'multipleAttachments', editable: false, options: {} }
const name = { column_name: 'n', title: 'Название', kind: 'singleLineText', editable: true, options: {} }
const files = [{ id: 5, name: 'акт.pdf', size: 2048, mime: 'application/pdf' }, { id: 6, name: 'прибор.cal', size: 10, mime: 'application/octet-stream' }]

test('карточка: скачать, открыть только PDF/картинки, загрузить и убрать (правящий)', async () => {
  const calls = []
  server.use(
    http.post('/api/uploads', async ({ request }) => {
      calls.push(['up', new URL(request.url).searchParams.get('name'), request.headers.get('content-type')])
      return HttpResponse.json({ id: 9, name: 'новый.png', size: 3 })
    }),
    http.post('/api/tables/1/records/7/attachments', async ({ request }) => { calls.push(['attach', await request.json()]); return HttpResponse.json({ ok: true }) }),
    http.delete('/api/tables/1/records/7/attachments/6', () => { calls.push(['detach']); return HttpResponse.json({ ok: true }) }),
  )
  const onChanged = vi.fn()
  render(<Card tableId={1} record={{ id: 7, ph: files, n: 'x' }} fields={[name, photo]} onSave={vi.fn()} onClose={vi.fn()} onChanged={onChanged} />)
  expect(screen.getByRole('link', { name: 'акт.pdf' })).toHaveAttribute('href', '/api/attachments/5')
  expect(screen.getAllByRole('link', { name: 'открыть' })).toHaveLength(1)     // .cal — только скачать

  await userEvent.upload(screen.getByLabelText('Файлы: Фото'), new File(['png'], 'новый.png', { type: 'image/png' }))
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls[0]).toEqual(['up', 'новый.png', 'application/octet-stream'])
  expect(calls[1]).toEqual(['attach', { column: 'ph', ids: [9] }])
  await userEvent.click(screen.getByRole('button', { name: 'Убрать файл прибор.cal' }))
  await vi.waitFor(() => expect(calls.at(-1)).toEqual(['detach']))
})

test('карточка без прав правки: файлы только скачать', () => {
  render(<Card tableId={1} record={{ id: 7, ph: files }} fields={[{ ...name, editable: false }, photo]} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.queryByLabelText('Файлы: Фото')).toBeNull()
  expect(screen.queryByRole('button', { name: /Убрать файл/ })).toBeNull()
})

test('форма: файлы загружаются заранее, в отправку уходят их id', async () => {
  const posts = []
  server.use(
    http.get('/api/forms', () => HttpResponse.json([{ id: 3, title: 'Калибровка', table_id: 2, table: 'Журнал' }])),
    http.get('/api/forms/3', () => HttpResponse.json({ id: 3, title: 'Калибровка', after_message: 'Принято', table_id: 2,
      fields: [{ column_name: 'ph', title: 'Файлы', kind: 'multipleAttachments', options: {}, required: true, help: null }] })),
    http.post('/api/uploads', () => HttpResponse.json({ id: 41, name: 'mir.cal', size: 5 })),
    http.post('/api/forms/3/submit', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ id: 1 }) }),
  )
  render(<Forms />)
  await userEvent.click(await screen.findByRole('button', { name: /Калибровка/ }))
  await userEvent.upload(await screen.findByLabelText('Файлы: Файлы *'), new File(['x'], 'mir.cal'))
  expect(await screen.findByRole('link', { name: 'mir.cal' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByText('Принято')
  expect(posts[0].values).toEqual({ ph: [41] })
})
