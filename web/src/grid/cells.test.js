import { expect, test } from 'vitest'
import { GridCellKind } from '@glideapps/glide-data-grid'
import { toCell, fromCell, displayValue } from './cells.js'

const fText = { kind: 'singleLineText', editable: true }
const fNum = { kind: 'number', editable: true }
const fCheck = { kind: 'checkbox', editable: true }
const fAuto = { kind: 'autoNumber', editable: false }
const fSelect = { kind: 'singleSelect', editable: true }

test('текст — редактируемая Text-ячейка', () => {
  const c = toCell(fText, 'Кольцо')
  expect(c.kind).toBe(GridCellKind.Text)
  expect(c.data).toBe('Кольцо')
  expect(c.allowOverlay).toBe(true)
})

test('число — Number-ячейка', () => {
  expect(toCell(fNum, 5).kind).toBe(GridCellKind.Number)
})

test('checkbox — Boolean-ячейка', () => {
  const c = toCell(fCheck, true)
  expect(c.kind).toBe(GridCellKind.Boolean)
  expect(c.data).toBe(true)
})

test('неэдитируемое поле — allowOverlay false', () => {
  expect(toCell(fAuto, 3).allowOverlay).toBe(false)
})

test('singleSelect редактируется в карточке — в сетке не оверлеим', () => {
  expect(toCell(fSelect, 'Брак').allowOverlay).toBe(false)
})

test('null → пустая строка', () => {
  expect(toCell(fText, null).displayData).toBe('')
})

test('fromCell достаёт data', () => {
  expect(fromCell(fNum, { kind: GridCellKind.Number, data: 9 })).toBe(9)
  expect(fromCell(fCheck, { kind: GridCellKind.Boolean, data: false })).toBe(false)
})

const fFormulaNum = { kind: 'formula', editable: false, options: { result: { type: 'number' } } }
const fFormulaText = { kind: 'formula', editable: false, options: { result: { type: 'singleLineText' } } }
const fCount = { kind: 'count', editable: false, options: {} }
const fLookupLink = { kind: 'multipleLookupValues', editable: false, options: { result: { type: 'multipleRecordLinks' } } }
const fLookupText = { kind: 'multipleLookupValues', editable: false, options: { result: { type: 'singleLineText' } } }

test('формула-число — Number-ячейка, только чтение', () => {
  const c = toCell(fFormulaNum, 2.5)
  expect(c.kind).toBe(GridCellKind.Number)
  expect(c.allowOverlay).toBe(false)
})

test('count — число', () => {
  expect(toCell(fCount, 3).kind).toBe(GridCellKind.Number)
})

test('NaN, Infinity и #ERROR! показываются текстом', () => {
  expect(toCell(fFormulaNum, { specialValue: 'NaN' }).displayData).toBe('NaN')
  expect(toCell(fFormulaNum, { specialValue: 'Infinity' }).displayData).toBe('∞')
  expect(toCell(fFormulaText, { error: '#ERROR!' }).displayData).toBe('#ERROR!')
})

test('lookup текста — через запятую; связи и lookup связи — названиями записей', () => {
  expect(toCell(fLookupText, ['a', 'b']).displayData).toBe('a, b')
  expect(toCell(fLookupLink, [{ id: 1, name: 'Кольцо' }, { id: 2, name: 'Втулка' }]).displayData).toBe('Кольцо, Втулка')
  const link = { kind: 'multipleRecordLinks', editable: false, options: {} }
  expect(toCell(link, [{ id: 7, name: 'МИР 295' }]).displayData).toBe('МИР 295')
  expect(toCell(link, null).displayData).toBe('')   // таблица скрыта от роли
})

test('displayValue для карточки', () => {
  expect(displayValue(fFormulaText, { error: '#ERROR!' })).toBe('#ERROR!')
  expect(displayValue(fFormulaText, null)).toBe('—')
  expect(displayValue(fLookupText, ['a', 'b'])).toBe('a, b')
})

test('пользователь Airtable (lastModifiedBy и пр.) — по имени', () => {
  const f = { kind: 'lastModifiedBy', editable: false, options: {} }
  expect(toCell(f, { id: 'usr1', name: 'Teka Waqa', email: 'x@y' }).displayData).toBe('Teka Waqa')
  expect(displayValue({ kind: 'multipleCollaborators', editable: false }, [{ name: 'А' }, { name: 'Б' }])).toBe('А, Б')
})

test('число показывается с точностью поля, без шума float', () => {
  const f = { kind: 'formula', editable: false, options: { result: { type: 'currency', options: { precision: 2 } } } }
  expect(toCell(f, 22966384.400000006).displayData).toBe('22966384.40')
  expect(displayValue(f, 22966384.400000006)).toBe('22966384.40')
  const noPrec = { kind: 'rollup', editable: false, options: { result: { type: 'number' } } }
  expect(toCell(noPrec, 0.1 + 0.2).displayData).toBe('0.3')
})
