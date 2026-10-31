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
