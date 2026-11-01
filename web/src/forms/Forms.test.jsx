import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import Forms from './Forms.jsx'

const form = {
  id: 7, title: 'Журнал по оборудованию', after_message: 'Спасибо! Информация принята', table_id: 3,
  fields: [
    { column_name: 'd', title: 'Дата', kind: 'date', options: {}, required: true, help: '(дата события)' },
    { column_name: 'eq', title: 'Оборудование', kind: 'multipleRecordLinks', options: {}, required: true, help: null, link_table: 5 },
    { column_name: 'cat', title: 'Категория', kind: 'singleSelect', options: { choices: [{ id: 's1', name: 'Ремонт' }] }, required: false, help: null },
  ],
}

function setup() {
  const posts = []
  server.use(
    http.get('/api/forms', () => HttpResponse.json([{ id: 7, title: form.title, table_id: 3, table: 'Журнал' }])),
    http.get('/api/forms/7', () => HttpResponse.json(form)),
    http.get('/api/tables/5/names', () => HttpResponse.json([{ id: 11, name: 'МИР 295' }, { id: 12, name: 'МИР 296' }, { id: 13, name: 'Кожух 1' }])),
    http.post('/api/forms/7/submit', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ id: 500 }) }),
  )
  render(<Forms />)
  return posts
}

test('заполнение и отправка: обязательные, выбор связи поиском, сообщение после отправки', async () => {
  const posts = setup()
  await userEvent.click(await screen.findByRole('button', { name: /Журнал по оборудованию/ }))
  expect(await screen.findByText('(дата события)')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Заполните: Дата, Оборудование')
  expect(posts).toHaveLength(0)

  await userEvent.type(screen.getByLabelText('Дата *'), '2026-11-01')
  await userEvent.type(screen.getByLabelText('Поиск: Оборудование *'), 'мир 296')
  await userEvent.click(screen.getByRole('button', { name: 'МИР 296' }))
  expect(screen.queryByRole('button', { name: 'МИР 295' })).toBeNull()      // поиск отсёк
  await userEvent.selectOptions(screen.getByLabelText('Категория'), 'Ремонт')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))

  expect(await screen.findByText('Спасибо! Информация принята')).toBeInTheDocument()
  expect(posts).toHaveLength(1)
  expect(posts[0].values).toEqual({ d: '2026-11-01', eq: [12], cat: 'Ремонт' })
  expect(posts[0].key.length).toBeGreaterThanOrEqual(8)

  await userEvent.click(screen.getByRole('button', { name: 'Заполнить ещё' }))
  expect(screen.getByLabelText('Дата *')).toHaveValue('')
})

test('ошибка сервера показывается, ключ отправки при повторе тот же (E6)', async () => {
  const posts = setup()
  let fail = true
  server.use(http.post('/api/forms/7/submit', async ({ request }) => {
    posts.push(await request.json())
    return fail ? HttpResponse.json({ detail: 'Нет таких записей: Оборудование' }, { status: 422 }) : HttpResponse.json({ id: 1 })
  }))
  await userEvent.click(await screen.findByRole('button', { name: /Журнал по оборудованию/ }))
  await userEvent.type(await screen.findByLabelText('Дата *'), '2026-11-01')
  await userEvent.type(screen.getByLabelText('Поиск: Оборудование *'), 'кожух')
  await userEvent.click(screen.getByRole('button', { name: 'Кожух 1' }))
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет таких записей: Оборудование')
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByText('Спасибо! Информация принята')
  expect(posts[0].key).toBe(posts[1].key)
})
