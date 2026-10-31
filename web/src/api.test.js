import { expect, test } from 'vitest'
import { api, ApiError } from './api.js'

test('GET возвращает JSON', async () => {
  expect(await api('/api/tables')).toHaveLength(2)
})

test('ошибка несёт статус', async () => {
  await expect(api('/api/auth/login', { method: 'POST', body: { login: 'x', password: 'bad' } }))
    .rejects.toMatchObject({ status: 401 })
})

test('ApiError — это Error', () => {
  expect(new ApiError(409, '')).toBeInstanceOf(Error)
})
