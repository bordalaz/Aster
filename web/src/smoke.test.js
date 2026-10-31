import { expect, test } from 'vitest'
import { tables } from './test/fixtures.js'

test('фикстуры на месте', () => {
  expect(tables).toHaveLength(2)
})
