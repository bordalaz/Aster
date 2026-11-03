import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ButtonDialog, ButtonRun, FieldButton, buttonStyle, prefillValues } from './ButtonField.jsx'

test('цвет кнопки по варианту Airtable', () => {
  expect(buttonStyle('solidBlue')).toEqual({ background: '#2d7ff9', color: '#fff' })
  expect(buttonStyle('lightGray')).toEqual({ background: '#eeeeee', color: '#1d1f25' })
  expect(buttonStyle('textBlue').background).toBe('transparent')
})

test('подстановка формы: связь → id (или названия), значение, пустое пропускается', () => {
  const action = { prefill: [{ col: 'eq', from: 'eq' }, { col: 'st', value: 'Разобрали' }, { col: 'note', from: 'note' }, { col: 'txt', from: 'eq' }] }
  const row = { id: 7, eq: [{ id: 3, name: 'Гамма-зонд 620' }], note: '' }
  expect(prefillValues(action, row, { eq: 'multipleRecordLinks', txt: 'singleLineText' }))
    .toEqual({ eq: [3], st: 'Разобрали', txt: 'Гамма-зонд 620' })
})

test('кнопка-скрипт неактивна, обычная зовёт run', () => {
  const run = vi.fn()
  const f = { column_name: 'b', title: 'Добавить фото', kind: 'button', options: { label: 'Фото+', variant: 'solidBlue', action: { kind: 'edit', fields: [] } } }
  const s = { ...f, column_name: 's', options: { label: 'Run script', action: { kind: 'script' } } }
  render(<ButtonRun.Provider value={run}><FieldButton field={f} row={{ id: 1 }} /><FieldButton field={s} row={{ id: 1 }} /></ButtonRun.Provider>)
  expect(screen.getByRole('button', { name: 'Run script' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Фото+' }))
  expect(run).toHaveBeenCalledWith(f, { id: 1 })
})

test('окно правки: обязательные поля, сохранение значений записи', async () => {
  const fields = [{ column_name: 'pn', title: 'P/N', kind: 'singleLineText', editable: true },
    { column_name: 'rack', title: 'Стеллаж', kind: 'singleLineText', editable: true }]
  const btn = { title: 'Добавить адрес хранения', options: { action: { kind: 'edit', fields: [{ col: 'rack', required: true, help: 'Нумерация от двери' }] } } }
  const onSave = vi.fn().mockResolvedValue(), onClose = vi.fn()
  render(<ButtonDialog field={btn} row={{ id: 5, pn: '10235' }} tableId={1} fields={fields} primaryField="pn" onSave={onSave} onClose={onClose} />)
  expect(screen.getByText('10235')).toBeTruthy()
  expect(screen.getByText('Нумерация от двери')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Заполните: Стеллаж')
  fireEvent.change(screen.getByLabelText('Стеллаж *'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(onSave).toHaveBeenCalledWith({ rack: '3' })
})
