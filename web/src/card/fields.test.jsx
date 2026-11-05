import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FieldEditor from './fields.jsx'

test('текст: меняет значение', async () => {
  const onChange = vi.fn()
  render(<FieldEditor field={{ kind: 'singleLineText', editable: true, title: 'Имя' }} value="a" onChange={onChange} />)
  await userEvent.type(screen.getByLabelText('Имя'), 'b')
  expect(onChange).toHaveBeenCalled()
})

test('checkbox: переключает', async () => {
  const onChange = vi.fn()
  render(<FieldEditor field={{ kind: 'checkbox', editable: true, title: 'Флаг' }} value={false} onChange={onChange} />)
  await userEvent.click(screen.getByLabelText('Флаг'))
  expect(onChange).toHaveBeenCalledWith(true)
})

test('singleSelect: варианты из choices', () => {
  render(<FieldEditor
    field={{ kind: 'singleSelect', editable: true, title: 'Статус', options: { choices: [{ id: '1', name: 'На складе' }, { id: '2', name: 'Брак' }] } }}
    value="Брак" onChange={() => {}} />)
  expect(screen.getByLabelText('Статус')).toHaveValue('Брак')
  expect(screen.getByRole('option', { name: 'На складе' })).toBeInTheDocument()
})

test('неэдитируемое: только текст, без поля ввода', () => {
  render(<FieldEditor field={{ kind: 'autoNumber', editable: false, title: '№' }} value={7} onChange={() => {}} />)
  expect(screen.getByText('7')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('связь: мини-карточка с первыми полями связанной таблицы, как в Airtable', async () => {
  const field = { kind: 'multipleRecordLinks', title: 'Позиции', column_name: 'x', link_table: 1, options: { virtual: true } }
  render(<FieldEditor inline field={field} value={[{ id: 1, name: 'Кольцо' }]} />)
  expect(screen.getByText('Кольцо')).toBeInTheDocument()
  // первичное «Наименование» не повторяется; дальше по порядку полей: Кол-во, На складе, Статус
  expect(await screen.findByText('Кол-во')).toBeInTheDocument()
  expect(screen.getByText('Статус')).toBeInTheDocument()
  expect(screen.queryByText('Наименование')).toBeNull()
})

test('множественный выбор: как в Airtable — плашки с крестиком, остальные варианты в выпадающем списке', async () => {
  const field = { column_name: 'eq', title: 'Оборудование', kind: 'multipleSelects', editable: true,
    options: { choices: [{ name: 'Пульсатор', color: 'orangeLight2' }, { name: 'Гамма', color: 'blueLight2' }, { name: 'ТС', color: 'redLight2' }] } }
  const onChange = vi.fn()
  render(<FieldEditor field={field} value={['Пульсатор']} onChange={onChange} />)
  const list = screen.getByRole('combobox', { name: 'Оборудование' })
  expect([...list.options].map(o => o.text)).toEqual(['Добавить…', 'Гамма', 'ТС'])   // выбранного в списке нет
  expect(screen.queryByRole('checkbox')).toBeNull()                                   // весь список не раскрыт
  await userEvent.selectOptions(list, 'ТС')
  expect(onChange).toHaveBeenLastCalledWith(['Пульсатор', 'ТС'])
  await userEvent.click(screen.getByRole('button', { name: 'Убрать Пульсатор' }))
  expect(onChange).toHaveBeenLastCalledWith([])
})

test('связь: «+ Добавить» — поиск записи, выбор добавляет; «×» убирает; одна запись — без «Добавить»', async () => {
  const { http, HttpResponse } = await import('msw')
  const { server } = await import('../test/server.js')
  server.use(http.get('/api/tables/1/names', () => HttpResponse.json([{ id: 1, name: 'Кольцо' }, { id: 2, name: 'Корпус батареи_№_4288' }, { id: 3, name: 'Пенал_№_2' }])))
  const field = { kind: 'multipleRecordLinks', title: 'Оборудование', column_name: 'x', link_table: 1, editable: true, options: { virtual: true } }
  const onChange = vi.fn()
  const { rerender } = render(<FieldEditor inline field={field} value={[{ id: 1, name: 'Кольцо' }]} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: 'Добавить: Оборудование' }))
  await userEvent.type(await screen.findByLabelText('Поиск: Оборудование'), '4288')
  expect(screen.queryByRole('option', { name: 'Пенал_№_2' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Кольцо' })).toBeNull()          // уже выбранное в списке не повторяется
  await userEvent.keyboard('{Enter}')
  expect(onChange).toHaveBeenLastCalledWith([{ id: 1, name: 'Кольцо' }, { id: 2, name: 'Корпус батареи_№_4288' }])
  await userEvent.click(screen.getByRole('button', { name: 'Убрать Кольцо' }))
  expect(onChange).toHaveBeenLastCalledWith([])
  rerender(<FieldEditor inline field={{ ...field, options: { prefersSingleRecordLink: true } }} value={[{ id: 1, name: 'Кольцо' }]} onChange={onChange} />)
  expect(screen.queryByRole('button', { name: 'Добавить: Оборудование' })).toBeNull()
})

test('связь: «Создать запись» — новая запись в связанной таблице с текстом поиска, сразу в связи', async () => {
  const { http, HttpResponse } = await import('msw')
  const { server } = await import('../test/server.js')
  const posts = []
  server.use(
    http.get('/api/tables/7/names', () => HttpResponse.json([{ id: 1, name: 'НЮ_РемЦех' }])),
    http.get('/api/tables/7/fields', () => HttpResponse.json([{ column_name: 'name', title: 'Код', kind: 'singleLineText', editable: true }])),
    http.get('/api/tables/7/views', () => HttpResponse.json([])),
    http.get('/api/tables', () => HttpResponse.json([{ id: 7, title: 'Заказчики', primary_field: 'name' }])),
    http.post('/api/tables/7/records', () => HttpResponse.json({ id: 50, updated_at: 't' })),
    http.patch('/api/tables/7/records/50', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ id: 50, updated_at: 't2' }) }),
  )
  const field = { kind: 'multipleRecordLinks', title: 'Заказчик', column_name: 'x', link_table: 7, editable: true, options: {} }
  const onChange = vi.fn()
  const opened = vi.fn()
  window.addEventListener('aster:open-record', e => opened(e.detail))
  render(<FieldEditor inline field={field} value={[]} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: 'Добавить: Заказчик' }))
  await userEvent.type(await screen.findByLabelText('Поиск: Заказчик'), 'ГПН')
  await userEvent.click(await screen.findByRole('button', { name: 'Создать запись «ГПН»' }))
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith([{ id: 50, name: 'ГПН' }]))
  expect(posts[0].values).toEqual({ name: 'ГПН' })
  expect(opened).toHaveBeenCalledWith({ tableId: 7, id: 50 })   // карточка новой записи — поверх
})

test('стопка связей: видно 15, «Показать все N» — окно со всеми; карточку можно перетащить', async () => {
  const { fireEvent, within } = await import('@testing-library/react')
  const field = { kind: 'multipleRecordLinks', title: 'Перемещения', column_name: 'x', link_table: 1, editable: true, options: { virtual: true } }
  const list = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, name: `П-${i + 1}` }))
  const onChange = vi.fn()
  render(<FieldEditor inline field={field} value={list} onChange={onChange} />)
  expect(screen.getAllByRole('button', { name: /^Убрать П-/ })).toHaveLength(15)
  expect(screen.queryByText('П-16')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Показать все связанные записи (35)' }))
  const box = screen.getByRole('dialog', { name: 'Перемещения' })
  expect(within(box).getAllByRole('button', { name: /^Убрать П-/ })).toHaveLength(35)
  // П-3 перетащили на место П-1 — встаёт первой
  const wrap = name => within(box).getByText(name).closest('.link-card-wrap')
  document.elementFromPoint = () => wrap('П-1')   // jsdom не раскладывает — под указателем П-1
  fireEvent.pointerDown(wrap('П-3'), { button: 0, clientX: 10, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
  fireEvent.pointerUp(window)
  expect(onChange.mock.calls.at(-1)[0].slice(0, 4).map(v => v.name)).toEqual(['П-3', 'П-1', 'П-2', 'П-4'])
})

test('связи-события (link_events) — свежие сверху; перетаскивание уходит в хранимом порядке (старые→новые)', async () => {
  const { fireEvent } = await import('@testing-library/react')
  const field = { kind: 'multipleRecordLinks', title: 'Перемещения', column_name: 'x', link_table: 1, editable: true, link_events: true, options: { virtual: true } }
  const list = [{ id: 1, name: 'старое' }, { id: 2, name: 'среднее' }, { id: 3, name: 'свежее' }]
  const onChange = vi.fn()
  render(<FieldEditor inline field={field} value={list} onChange={onChange} />)
  const names = [...document.querySelectorAll('.link-card-name')].map(x => x.textContent)
  expect(names).toEqual(['свежее', 'среднее', 'старое'])
  const wrap = name => screen.getByText(name).closest('.link-card-wrap')
  document.elementFromPoint = () => wrap('свежее')
  fireEvent.pointerDown(wrap('старое'), { button: 0, clientX: 10, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
  fireEvent.pointerUp(window)
  // на экране: старое, свежее, среднее → хранится наоборот
  expect(onChange.mock.calls.at(-1)[0].map(v => v.name)).toEqual(['среднее', 'свежее', 'старое'])
})

test('«По дате»: вопрос «Да / Нет», «Больше не спрашивать» помнится; расставляет по дате события (старые→новые)', async () => {
  const { http, HttpResponse } = await import('msw')
  const { server } = await import('../test/server.js')
  server.use(http.get('/api/tables/1/records', () => HttpResponse.json([
    { id: 1, dt: '2026-03-01' }, { id: 2, dt: '2026-01-01' }, { id: 3, dt: null }, { id: 4, dt: '2026-02-01' }])))
  localStorage.removeItem('aster.ask.sortLinks')
  const field = { kind: 'multipleRecordLinks', title: 'Перемещения', column_name: 'x', link_table: 1, editable: true, link_events: 'dt', options: { virtual: true } }
  const list = [1, 2, 3, 4].map(id => ({ id, name: `П-${id}` }))
  const onChange = vi.fn()
  render(<FieldEditor inline field={field} value={list} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: 'По дате' }))
  const ask = screen.getByRole('alertdialog', { name: 'Расставить по дате события?' })
  expect(ask).toHaveTextContent('Местонахождение')
  await userEvent.click(screen.getByRole('button', { name: 'Нет' }))
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'По дате' }))
  await userEvent.click(screen.getByLabelText('Больше не спрашивать'))
  await userEvent.click(screen.getByRole('button', { name: 'Да, расставить' }))
  await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
  expect(onChange.mock.calls[0][0].map(v => v.id)).toEqual([2, 4, 1, 3])   // без даты — в конце
  expect(localStorage.getItem('aster.ask.sortLinks')).toBe('off')
  await userEvent.click(screen.getByRole('button', { name: 'По дате' }))   // больше не спрашивает
  expect(screen.queryByRole('alertdialog')).toBeNull()
})
