import { expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api.js', () => ({
  api: vi.fn(async url => {
    if (url === '/api/tables') return [{ id: 2, title: 'Оборудование', primary_field: 'nm' }, { id: 3, title: 'НПВ', primary_field: 'nm' }]
    if (url.endsWith('/fields')) return [{ column_name: 'nm', title: 'Имя', kind: 'singleLineText', editable: true, options: {} }]
    const t = url.match(/tables\/(\d+)/)[1]
    return [{ id: 1, updated_at: 'x', nm: t === '2' ? 'Пенал_№_2' : 'НПВ_5' }]
  }),
}))
const { default: RecordHost } = await import('./RecordHost.jsx')
const { openRecord } = await import('./data.js')

test('связанные записи — стопкой поверх, с подписью таблицы; Esc закрывает только верхнюю', async () => {
  render(<RecordHost />)
  act(() => openRecord(2, 1))
  expect(await screen.findByRole('dialog', { name: 'Пенал_№_2' })).toBeInTheDocument()
  act(() => openRecord(3, 1))
  expect(await screen.findByRole('dialog', { name: 'НПВ_5' })).toBeInTheDocument()
  expect(screen.getByText('Запись из «НПВ»')).toBeInTheDocument()
  expect(screen.getAllByRole('dialog')).toHaveLength(2)
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'НПВ_5' })).toBeNull())
  expect(screen.getByRole('dialog', { name: 'Пенал_№_2' })).toBeInTheDocument()
})
