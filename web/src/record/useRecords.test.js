import { expect, test } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRecords } from './useRecords.js'

test('грузит невиртуальные поля и записи', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  // из 6 полей фикстуры одно виртуальное (связь) — должно отсеяться → 5
  expect(result.current.fields).toHaveLength(5)
  expect(result.current.fields.some(f => f.options.virtual)).toBe(false)
  expect(result.current.rows).toHaveLength(2)
})

test('patch обновляет строку и updated_at', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.rows[0].updated_at
  await act(() => result.current.patch(result.current.rows[0], { f_fld00000000000002: 42 }))
  const row = result.current.rows.find(r => r.id === 1)
  expect(row.f_fld00000000000002).toBe(42)
  expect(row.updated_at).not.toBe(before)
})

test('patch при устаревшем updated_at бросает 409 и перезагружает', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const stale = { ...result.current.rows[0], updated_at: '2000-01-01T00:00:00+00:00' }
  await expect(Promise.resolve(act(() => result.current.patch(stale, { f_fld00000000000002: 1 })))).rejects.toMatchObject({ status: 409 })
})
