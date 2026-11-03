import { render, screen, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'
import { server } from '../test/server.js'
import ListView, { childrenBy } from './ListView.jsx'

test('дети по полю-связи; запись с двумя родителями — под обоими', () => {
  const m = childrenBy([{ id: 1, p: [{ id: 10 }] }, { id: 2, p: [{ id: 10 }, { id: 11 }] }, { id: 3, p: [] }], 'p')
  expect(m.get(10).map(r => r.id)).toEqual([1, 2])
  expect(m.get(11).map(r => r.id)).toEqual([2])
})

test('уровни: Заказчики → Работы (эта таблица), раскрытие, фильтр уровня, открытие записи', async () => {
  server.use(
    http.get('/api/tables/5/fields', () => HttpResponse.json([{ column_name: 'n', title: 'Заказчик', kind: 'singleLineText' }])),
    http.get('/api/tables/5/records', () => HttpResponse.json([{ id: 10, n: 'ГПНХ' }, { id: 11, n: 'БКС' }])),
  )
  const fields = [{ column_name: 'w', title: 'Работа', kind: 'singleLineText' }, { column_name: 'cust', title: 'Заказчик', kind: 'multipleRecordLinks' },
    { column_name: 'st', title: 'Статус', kind: 'singleLineText' }]
  const rows = [{ id: 1, w: 'ЮПО_1', cust: [{ id: 10, name: 'ГПНХ' }], st: 'План' }, { id: 2, w: 'ЮПО_2', cust: [{ id: 10, name: 'ГПНХ' }], st: 'Закончен' }]
  const onOpen = vi.fn(), onOpenLink = vi.fn()
  render(<ListView fields={fields} rows={rows} onOpen={onOpen} onOpenLink={onOpenLink} config={{ levels: [
    { table: 5, columns: ['n'] }, { table: 1, link: 'cust', columns: ['w', 'st'], filters: [{ col: 'st', op: 'contains', value: 'План' }] }] }} />)
  expect(await screen.findByText('ГПНХ')).toBeTruthy()
  expect(screen.queryByText('ЮПО_1')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть' })[0])
  expect(screen.getByText('ЮПО_1')).toBeTruthy()
  expect(screen.queryByText('ЮПО_2')).toBeNull()            // фильтр уровня
  fireEvent.click(screen.getByText('ЮПО_1'))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), [1])
  fireEvent.click(screen.getByText('БКС'))
  expect(onOpenLink).toHaveBeenCalledWith(5, 11)
})
