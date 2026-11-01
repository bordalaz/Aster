import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TableTabs from './TableTabs.jsx'

const tables = [{ id: 1, title: 'Ведомость ЗИП' }, { id: 2, title: 'Оборудование' }]

test('вкладки таблиц: активная отмечена, клик выбирает', async () => {
  const onPick = vi.fn()
  render(<TableTabs tables={tables} activeId={2} onPick={onPick} />)
  expect(screen.getByRole('tab', { name: 'Оборудование' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Ведомость ЗИП' }))
  expect(onPick).toHaveBeenCalledWith(1)
})

test('«Все таблицы» — список всех таблиц', async () => {
  const onPick = vi.fn()
  render(<TableTabs tables={tables} activeId={1} onPick={onPick} />)
  await userEvent.click(screen.getByRole('button', { name: /Все таблицы/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Оборудование' }))
  expect(onPick).toHaveBeenCalledWith(2)
})
