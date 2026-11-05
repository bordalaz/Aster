import { expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import { fields1, records1 } from '../test/fixtures.js'
import Card from './Card.jsx'

const rec = records1[0]

test('история — в правой панели одной лентой с комментариями, новое внизу; убранное зачёркнуто, новое в рамке', async () => {
  localStorage.removeItem('aster.feed')
  server.use(
    http.get(`/api/tables/1/records/${rec.id}/history`, () => HttpResponse.json([
      { at: '2026-10-31T10:00:00Z', column_name: 'f_fld00000000000002', field: 'Кол-во', old: 5, new: 9, user: 'Иван' },
      { at: '2026-10-30T10:00:00Z', column_name: 'id', field: null, old: null, new: rec.id, user: 'система' },
    ])),
    http.get(`/api/tables/1/records/${rec.id}/comments`, () => HttpResponse.json([
      { id: 7, at: '2026-10-30T12:00:00Z', user: 'Пётр', text: 'проверить', mine: false },
    ])))
  render(<Card tableId={1} record={rec} fields={fields1} onSave={vi.fn()} onClose={vi.fn()} />)
  const side = screen.getByRole('complementary', { name: 'Активность' })
  expect(await within(side).findByText('Иван')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'История изменений' })).toBeNull()   // в теле карточки истории нет
  const order = [...side.querySelectorAll('li')].map(li => li.textContent)
  expect(order[0]).toMatch(/Запись создана/)
  expect(order[1]).toMatch(/проверить/)
  expect(order[2]).toMatch(/Кол-во/)
  expect(side.querySelector('del').textContent).toBe('5')
  expect(side.querySelector('ins').textContent).toBe('9')
  await userEvent.click(within(side).getByRole('button', { name: /Вся активность/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Комментарии' }))
  expect(within(side).queryByText('Иван')).toBeNull()
  expect(localStorage.getItem('aster.feed')).toBe('comments')
})

test('связь в истории: только что убрали и что добавили', async () => {
  localStorage.setItem('aster.feed', 'history')
  const link = { column_name: 'lk', title: 'Перемещения', kind: 'multipleRecordLinks', editable: true, options: {} }
  server.use(http.get(`/api/tables/1/records/${rec.id}/history`, () => HttpResponse.json([
    { at: '2026-10-31T10:00:00Z', column_name: 'lk', field: 'Перемещения', user: 'Иван',
      old: [{ id: 1, name: 'А' }, { id: 2, name: 'Б' }], new: [{ id: 2, name: 'Б' }, { id: 3, name: 'В' }] },
  ])))
  render(<Card tableId={1} record={rec} fields={[...fields1, link]} onSave={vi.fn()} onClose={vi.fn()} />)
  const side = screen.getByRole('complementary', { name: 'Активность' })
  await within(side).findByText('Иван')
  expect([...side.querySelectorAll('del')].map(x => x.textContent)).toEqual(['А'])
  expect([...side.querySelectorAll('ins')].map(x => x.textContent)).toEqual(['В'])
})

test('нет изменений — так и написано', async () => {
  localStorage.setItem('aster.feed', 'history')
  server.use(http.get(`/api/tables/1/records/${rec.id}/history`, () => HttpResponse.json([])))
  render(<Card tableId={1} record={rec} fields={fields1} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(await screen.findByText('Изменений не было')).toBeInTheDocument()
})

test('без прав на правку кнопки «Сохранить» нет', () => {
  const ro = fields1.map(f => ({ ...f, editable: false }))
  render(<Card record={rec} fields={ro} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
})
