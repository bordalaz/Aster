import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SelectEditor from './SelectEditor.jsx'

const cell = (value, multi = false) => ({ kind: 'custom', data: { kind: 'pills', multi, value,
  choices: [{ name: 'Брак', color: 'redBright' }, { name: 'На складе', color: 'greenLight2' }, { name: 'Списан', color: 'grayLight2' }] } })

test('один вариант: щелчок выбирает и закрывает', async () => {
  const done = vi.fn()
  render(<SelectEditor value={cell('Брак')} onChange={vi.fn()} onFinishedEditing={done} />)
  await userEvent.click(screen.getByRole('option', { name: 'На складе' }))
  expect(done.mock.calls[0][0].data.value).toBe('На складе')
})

test('поиск по вариантам и очистка', async () => {
  const done = vi.fn()
  render(<SelectEditor value={cell('Брак')} onChange={vi.fn()} onFinishedEditing={done} />)
  await userEvent.type(screen.getByPlaceholderText('Найти вариант'), 'спис')
  expect(screen.queryByRole('option', { name: 'Брак' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Очистить' }))
  expect(done.mock.calls[0][0].data.value).toBe(null)
})

test('несколько вариантов: щелчок переключает, список не закрывается', async () => {
  const change = vi.fn()
  render(<SelectEditor value={cell(['Брак'], true)} onChange={change} onFinishedEditing={vi.fn()} />)
  await userEvent.click(screen.getByRole('option', { name: 'Списан' }))
  expect(change.mock.calls[0][0].data.value).toEqual(['Брак', 'Списан'])
})
