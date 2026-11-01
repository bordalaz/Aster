import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Card from './Card.jsx'
import { fields1, records1 } from '../test/fixtures.js'

const fields = fields1.filter(f => !f.options.virtual)

test('показывает все невиртуальные поля записи', () => {
  render(<Card record={records1[0]} fields={fields} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByLabelText('Наименование')).toHaveValue('Кольцо')
  expect(screen.getByText('№')).toBeInTheDocument()            // autoNumber — только показ
})

test('правка эдитируемого поля и сохранение зовёт onSave с изменениями', async () => {
  const onSave = vi.fn().mockResolvedValue()
  render(<Card record={records1[0]} fields={fields} onSave={onSave} onClose={vi.fn()} />)
  await userEvent.clear(screen.getByLabelText('Кол-во'))
  await userEvent.type(screen.getByLabelText('Кол-во'), '42')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(onSave).toHaveBeenCalledWith({ f_fld00000000000002: 42 })
})

test('неэдитируемое поле не отдаётся в onSave', async () => {
  const onSave = vi.fn().mockResolvedValue()
  render(<Card record={records1[0]} fields={fields} onSave={onSave} onClose={vi.fn()} />)
  await userEvent.type(screen.getByLabelText('Наименование'), '!')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(Object.keys(onSave.mock.calls[0][0])).not.toContain('f_fld00000000000005')  // autoNumber
})

test('закрытие', async () => {
  const onClose = vi.fn()
  render(<Card record={records1[0]} fields={fields} onSave={vi.fn()} onClose={onClose} />)
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).toHaveBeenCalled()
})

test('связанные записи — кнопками; щелчок ведёт в связанную таблицу', async () => {
  const onOpenLink = vi.fn()
  const link = { column_name: 'lnk', title: 'Номенклатура', kind: 'multipleRecordLinks', editable: false, options: {}, link_table: 5 }
  const hidden = { ...link, column_name: 'h', title: 'Договор', link_table: null }
  render(<Card record={{ id: 1, lnk: [{ id: 9, name: 'Кольцо' }], h: null }} fields={[link, hidden]}
    onSave={vi.fn()} onClose={vi.fn()} onOpenLink={onOpenLink} />)
  await userEvent.click(screen.getByRole('button', { name: 'Кольцо' }))
  expect(onOpenLink).toHaveBeenCalledWith(5, 9)
  expect(screen.getByText('Договор').parentElement.textContent).toContain('—')
})
