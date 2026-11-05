import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api.js', () => ({
  api: vi.fn(async url => {
    if (url.endsWith('/names')) return [{ id: 1, name: 'Пульсатор_№_2855' }, { id: 2, name: 'Пульсатор_№_2856' }, { id: 3, name: 'Пенал_№_2' }]
    if (url.endsWith('/fields')) return []
    return []
  }),
}))
const { default: LinkEditor } = await import('./LinkEditor.jsx')

const field = { column_name: 'eq', title: 'ID_Оборудования', link_table: 9, options: {} }
const cellOf = value => ({ data: { link: field, value } })

test('набор на ячейке связи — поиск; выбрал — поиск пуст, ищем следующую; Esc — сохранить всё, как в Airtable', async () => {
  let cell = cellOf([])
  const onChange = vi.fn(c => { cell = c; view.rerender(<LinkEditor value={cell} onChange={onChange} onFinishedEditing={onDone} initialValue="2855" />) })
  const onDone = vi.fn()
  const view = render(<LinkEditor value={cell} onChange={onChange} onFinishedEditing={onDone} initialValue="2855" />)
  const input = screen.getByRole('textbox', { name: 'Поиск: ID_Оборудования' })
  expect(input).toHaveValue('2855')
  await userEvent.click(await screen.findByRole('option', { name: 'Пульсатор_№_2855' }))
  expect(onDone).not.toHaveBeenCalled()                       // правка открыта — можно искать дальше
  expect(input).toHaveValue('')
  await userEvent.type(input, '2856')
  expect(screen.queryByRole('option', { name: 'Пульсатор_№_2855' })).toBeNull()   // уже выбрана
  await userEvent.click(screen.getByRole('option', { name: 'Пульсатор_№_2856' }))
  await userEvent.keyboard('{Escape}')
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone.mock.calls[0][0].data.value.map(v => v.id)).toEqual([1, 2])
})
