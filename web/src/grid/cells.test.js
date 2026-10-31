import { expect, test } from 'vitest'
import { GridCellKind } from '@glideapps/glide-data-grid'
import { toCell, fromCell } from './cells.js'

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
