import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TableTabs from './TableTabs.jsx'

const tables = [{ id: 1, title: 'Ведомость ЗИП' }, { id: 2, title: 'Оборудование' }, { id: 3, title: 'Договоры', hidden: true }]

test('вкладки видимых таблиц: активная отмечена, клик выбирает; скрытых во вкладках нет', async () => {
  const onPick = vi.fn()
  render(<TableTabs tables={tables} activeId={2} onPick={onPick} />)
  expect(screen.getByRole('tab', { name: 'Оборудование' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: 'Договоры' })).toBeNull()
  await userEvent.click(screen.getByRole('tab', { name: 'Ведомость ЗИП' }))
  expect(onPick).toHaveBeenCalledWith(1)
})

test('«1 скрытая таблица» — открыть; админ может показать её снова', async () => {
  const onPick = vi.fn(), onHide = vi.fn()
  render(<TableTabs tables={tables} activeId={1} onPick={onPick} onHide={onHide} />)
  await userEvent.click(screen.getByRole('button', { name: /1 скрытая таблица/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Договоры' }))
  expect(onPick).toHaveBeenCalledWith(3)
  await userEvent.click(screen.getByRole('button', { name: /1 скрытая таблица/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Показать Договоры' }))
  expect(onHide).toHaveBeenCalledWith(3, false)
})

test('админ скрывает активную таблицу из её меню; у пользователя меню нет', async () => {
  const onHide = vi.fn()
  const { unmount } = render(<TableTabs tables={tables} activeId={2} onPick={vi.fn()} onHide={onHide} />)
  await userEvent.click(screen.getByRole('button', { name: 'Меню таблицы Оборудование' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Скрыть таблицу' }))
  expect(onHide).toHaveBeenCalledWith(2, true)
  unmount()
  render(<TableTabs tables={tables} activeId={2} onPick={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Меню таблицы Оборудование' })).toBeNull()
})
