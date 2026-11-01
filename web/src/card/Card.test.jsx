import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Card from './Card.jsx'
import { fields1, records1 } from '../test/fixtures.js'

const fields = fields1.filter(f => !f.options.virtual)
const NAME = 'f_fld00000000000001', QTY = 'f_fld00000000000002'

test('окно записи: название крупно, поля записи', () => {
  render(<Card record={records1[0]} fields={fields} primaryField={NAME} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByRole('dialog', { name: 'Кольцо' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Кольцо' })).toBeInTheDocument()
  expect(screen.getByText('№')).toBeInTheDocument()            // autoNumber — только показ
})

test('поле сохраняется само при уходе с него — как в Airtable, без кнопки «Сохранить»', async () => {
  const onSave = vi.fn().mockResolvedValue()
  render(<Card record={records1[0]} fields={fields} onSave={onSave} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
  await userEvent.clear(screen.getByLabelText('Кол-во'))
  await userEvent.type(screen.getByLabelText('Кол-во'), '42')
  expect(onSave).not.toHaveBeenCalled()
  await userEvent.tab()
  expect(onSave).toHaveBeenCalledWith({ [QTY]: 42 })
})

test('выбор сохраняется сразу', async () => {
  const onSave = vi.fn().mockResolvedValue()
  const st = { column_name: 'st', title: 'Статус', kind: 'singleSelect', editable: true,
    options: { choices: [{ name: 'Брак', color: 'redBright' }, { name: 'На складе', color: 'greenLight2' }] } }
  render(<Card record={{ id: 1, st: 'Брак' }} fields={[st]} onSave={onSave} onClose={vi.fn()} />)
  await userEvent.selectOptions(screen.getByLabelText('Статус'), 'На складе')
  expect(onSave).toHaveBeenCalledWith({ st: 'На складе' })
})

test('поля вида по порядку, остальные — под «Показать N скрытых полей»', async () => {
  render(<Card record={records1[0]} fields={fields} primaryField={NAME} shown={[NAME, QTY]} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByLabelText('Кол-во')).toBeInTheDocument()
  expect(screen.queryByText('№')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Показать \d+ скрыт/ }))
  expect(screen.getByText('№')).toBeInTheDocument()
})

test('закрытие и соседние записи', async () => {
  const onClose = vi.fn(), onNext = vi.fn()
  render(<Card record={records1[0]} fields={fields} onSave={vi.fn()} onClose={onClose} onNext={onNext} />)
  expect(screen.getByRole('button', { name: 'Предыдущая запись' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Следующая запись' }))
  expect(onNext).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).toHaveBeenCalled()
})

test('связанные записи — мини-карточками; щелчок ведёт в связанную таблицу', async () => {
  const onOpenLink = vi.fn()
  const link = { column_name: 'lnk', title: 'Номенклатура', kind: 'multipleRecordLinks', editable: false, options: {}, link_table: 5 }
  const hidden = { ...link, column_name: 'h', title: 'Договор', link_table: null }
  render(<Card record={{ id: 1, lnk: [{ id: 9, name: 'Кольцо' }], h: null }} fields={[link, hidden]}
    onSave={vi.fn()} onClose={vi.fn()} onOpenLink={onOpenLink} />)
  await userEvent.click(screen.getByRole('button', { name: 'Кольцо' }))
  expect(onOpenLink).toHaveBeenCalledWith(5, 9)
  expect(screen.getByText('Договор').closest('.fld').textContent).toContain('—')
})
