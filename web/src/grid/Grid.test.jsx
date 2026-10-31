import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Grid from './Grid.jsx'
import { fields1, records1 } from '../test/fixtures.js'

const fields = fields1.filter(f => !f.options.virtual)

test('счётчик записей и первичное поле первым', () => {
  render(<Grid fields={fields} rows={records1} primaryField="f_fld00000000000001" onEdit={vi.fn()} onOpen={vi.fn()} />)
  expect(screen.getByText('2 записи', { exact: false })).toBeInTheDocument()
  // порядок колонок доступен через data-атрибут контейнера (Grid его проставляет)
  const order = screen.getByTestId('col-order').textContent
  expect(order.startsWith('f_fld00000000000001')).toBe(true)
})

test('поиск фильтрует строки (счётчик меняется)', async () => {
  const user = (await import('@testing-library/user-event')).default
  render(<Grid fields={fields} rows={records1} primaryField="f_fld00000000000001" onEdit={vi.fn()} onOpen={vi.fn()} />)
  await user.type(screen.getByPlaceholderText('Поиск'), 'Кольцо')
  expect(screen.getByText('1 запись', { exact: false })).toBeInTheDocument()
})
