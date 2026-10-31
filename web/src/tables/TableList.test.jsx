import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TableList from './TableList.jsx'

const tables = [{ id: 1, title: 'Ведомость ЗИП', primary_field: 'x' }, { id: 2, title: 'Оборудование', primary_field: 'y' }]

test('рисует таблицы и отмечает активную', () => {
  render(<TableList tables={tables} activeId={2} onPick={() => {}} />)
  expect(screen.getByText('Ведомость ЗИП')).toBeInTheDocument()
  expect(screen.getByText('Оборудование')).toHaveAttribute('aria-current', 'true')
})

test('клик выбирает таблицу', async () => {
  const onPick = vi.fn()
  render(<TableList tables={tables} activeId={1} onPick={onPick} />)
  await userEvent.click(screen.getByText('Оборудование'))
  expect(onPick).toHaveBeenCalledWith(2)
})
