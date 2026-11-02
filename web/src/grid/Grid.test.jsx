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

test('поиск (из панели вида) фильтрует строки — счётчик меняется', () => {
  render(<Grid fields={fields} rows={records1} primaryField="f_fld00000000000001" onEdit={vi.fn()} onOpen={vi.fn()} search="Кольцо" />)
  expect(screen.getByText('1 запись', { exact: false })).toBeInTheDocument()
})

test('свёрнутые группы запоминаются по виду (как в Airtable)', () => {
  localStorage.setItem('aster.collapsed.k1', JSON.stringify(['Брак']))
  const props = { fields, rows: records1, primaryField: 'f_fld00000000000001', onEdit: vi.fn(), onOpen: vi.fn(),
    config: { group: 'f_fld00000000000004' }, onConfigChange: vi.fn() }
  const { unmount } = render(<Grid {...props} collapseKey="aster.collapsed.k1" />)
  expect(screen.getByTestId('grid-items').textContent).toBe('[Брак],[На складе],1')
  unmount()
  render(<Grid {...props} collapseKey="aster.collapsed.other" />)   // другой вид — своё состояние
  expect(screen.getByTestId('grid-items').textContent).toBe('[Брак],2,[На складе],1')
})
