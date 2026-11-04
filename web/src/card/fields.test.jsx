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
